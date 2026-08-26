/**
 * The exporter's frame-drawing seam: one interface, two implementations.
 *
 * - {@link Canvas2dRenderer} is a verbatim lift of the original draw block, so
 *   the fallback is provably identical to the pre-tonemap exporter (SDR
 *   exports are byte-for-byte the same file).
 * - {@link RawPlaneRenderer} tone-maps HDR frames itself. It never hands a
 *   frame *object* to the GPU — the browser tone-maps HDR on every such route
 *   (texImage2D, drawImage, copyTo-to-RGBA) — but reads the raw YUV planes
 *   via `copyTo()` and rebuilds the signal in webgl-tonemap.ts's two-pass
 *   pipeline. Its first real frame is verified texel-by-texel against the
 *   TypeScript reference before the path is trusted; on any doubt the export
 *   falls back to 2D and says so.
 */

import {
  ALL_FORMATS,
  BlobSource,
  Input,
  VideoSampleSink,
  type VideoSample,
} from "mediabunny";
import { createDoc, gradeOf, type ReframeDoc, type ReframeGrade } from "./model.ts";
import { cropTexMatrix, cropTransform, type CropRect, type SourceRotation } from "./solve.ts";
import {
  cssGradeFilter,
  parsePixelFormat,
  planeDimensions,
  type PixelFormatDesc,
  type SourceTransfer,
  type YuvLayout,
  type YuvMatrix,
} from "./tonemap.ts";
import { WebglToneMap, type PlaneData } from "./webgl-tonemap.ts";

export interface FrameRenderer {
  readonly canvas: OffscreenCanvas;
  readonly kind: "webgl" | "canvas2d";
  /** Which colour path ran, for reporting — the implementer can't see pixels. */
  readonly label: string;
  /** Draw one decoded sample through `crop` (sample-scaled display px). */
  render(sample: VideoSample, crop: CropRect): void | Promise<void>;
  dispose(): void;
}

/** The original 2D path, byte-identical to the pre-tonemap exporter. */
class Canvas2dRenderer implements FrameRenderer {
  readonly canvas: OffscreenCanvas;
  readonly kind = "canvas2d" as const;
  readonly label: string;
  private ctx: OffscreenCanvasRenderingContext2D;
  private target: { width: number; height: number };
  private filter: string;

  constructor(target: { width: number; height: number }, grade: ReframeGrade) {
    this.target = target;
    this.canvas = new OffscreenCanvas(target.width, target.height);
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not create a 2D canvas context.");
    ctx.imageSmoothingQuality = "high";
    this.ctx = ctx;
    // The grade's post-OETF stage as a canvas filter. Empty for the default
    // grade, in which case this path never touches ctx.filter at all — that
    // is what keeps SDR regression exports byte-identical.
    this.filter = "filter" in ctx ? cssGradeFilter(grade) : "";
    this.label = this.filter
      ? "Colour: browser conversion (2D canvas) + CSS grade filter"
      : "Colour: browser conversion (2D canvas)";
  }

  render(sample: VideoSample, crop: CropRect): void {
    const ctx = this.ctx;
    // Crop via a canvas transform that maps the crop rect onto the whole
    // canvas, then draw the frame whole. This uses draw()'s plain
    // destination-only path — the same shape as the preview's drawImage —
    // instead of its source-rect overload, while still letting mediabunny
    // apply any rotation metadata.
    const t = cropTransform(crop, this.target);
    ctx.save();
    if (this.filter) ctx.filter = this.filter;
    ctx.setTransform(t.scaleX, 0, 0, t.scaleY, t.translateX, t.translateY);
    sample.draw(ctx, 0, 0, sample.displayWidth, sample.displayHeight);
    ctx.restore();
  }

  dispose(): void {}
}

/**
 * Wrap a copyTo result in the per-plane views and row lengths the GL side
 * needs. Strides come back in bytes; row lengths are in texels.
 */
function makePlaneData(
  bytes: Uint8Array,
  layouts: ReadonlyArray<{ offset: number; stride: number }>,
  desc: PixelFormatDesc,
  width: number,
  height: number,
): PlaneData {
  const planes = planeDimensions(desc, width, height);
  const views: Array<Uint8Array | Uint16Array> = [];
  const rowLengths: number[] = [];
  for (let i = 0; i < planes.length; i++) {
    const { offset, stride } = layouts[i];
    if (desc.bitDepth > 8) {
      const byteOffset = bytes.byteOffset + offset;
      if (byteOffset % 2 !== 0 || stride % 2 !== 0) {
        throw new Error(`16-bit plane ${i} is not 2-byte aligned (offset ${offset}, stride ${stride}).`);
      }
      views.push(new Uint16Array(bytes.buffer, byteOffset, (bytes.byteLength - offset) >> 1));
      rowLengths.push(stride >> 1);
    } else {
      views.push(new Uint8Array(bytes.buffer, bytes.byteOffset + offset));
      // NV12's UV plane packs Cb+Cr into one RG8 texel = 2 bytes.
      rowLengths.push(Math.floor(stride / planes[i].samplesPerPixel));
    }
  }
  return { views, rowLengths };
}

/** Map a WebCodecs matrix name onto the ones the shader implements. */
function resolveMatrix(...candidates: Array<string | null | undefined>): YuvMatrix | null {
  for (const c of candidates) {
    if (c === "bt2020-ncl" || c === "bt709" || c === "smpte170m") return c;
    // bt470bg shares smpte170m's Kr/Kb for all practical purposes.
    if (c === "bt470bg") return "smpte170m";
  }
  return null;
}

/** The HDR path: raw planes in, tone-mapped crop on the canvas out. */
class RawPlaneRenderer implements FrameRenderer {
  readonly kind = "webgl" as const;
  readonly label: string;
  private timings: number[] = [];

  constructor(
    private glr: WebglToneMap,
    target: { width: number; height: number },
    private grade: ReframeGrade,
    private desc: PixelFormatDesc,
    private frameWidth: number,
    private frameHeight: number,
    private buffer: Uint8Array,
    transfer: SourceTransfer,
    formatName: string,
  ) {
    glr.setSize(target.width, target.height);
    this.label = `Colour: WebGL tone map (${transfer.toUpperCase()} → BT.709, ${grade.toneMap} · raw ${formatName} planes)`;
  }

  get canvas(): OffscreenCanvas {
    return this.glr.canvas;
  }

  async render(sample: VideoSample, crop: CropRect): Promise<void> {
    const start = performance.now();
    const layouts = await sample.copyTo(this.buffer);
    const data = makePlaneData(this.buffer, layouts, this.desc, this.frameWidth, this.frameHeight);
    const matrix = cropTexMatrix(
      crop,
      { width: sample.displayWidth, height: sample.displayHeight },
      sample.rotation as SourceRotation,
    );
    this.glr.renderPlanes(data, matrix, this.grade);
    // copyTo is the new per-frame cost (a GPU→CPU readback); measure it
    // instead of assuming. 30 frames rides out warm-up.
    if (this.timings.length < 30) {
      this.timings.push(performance.now() - start);
      if (this.timings.length === 30) {
        const avg = this.timings.reduce((a, b) => a + b, 0) / this.timings.length;
        if (avg > 16) console.warn(`reframe: raw-plane tone map averaging ${avg.toFixed(1)}ms/frame.`);
      }
    }
  }

  dispose(): void {
    this.glr.dispose();
  }
}

async function tryRawPlaneRenderer(
  doc: ReframeDoc,
  sample: VideoSample,
  trackColorSpace: VideoColorSpaceInit | null,
  transfer: SourceTransfer,
  grade: ReframeGrade,
): Promise<{ renderer: FrameRenderer } | { reason: string }> {
  const formatName = sample.format;
  const desc = formatName ? parsePixelFormat(formatName) : null;
  if (!desc) {
    return {
      reason: `this browser exposes no raw pixel data for these frames (format: ${formatName ?? "null"}).`,
    };
  }

  const width = sample.visibleRect.width;
  const height = sample.visibleRect.height;
  const layout: YuvLayout = {
    // The frame's own tag first, the container's colr box second (Safari
    // under-populates frame tags), the HDR-appropriate default last.
    matrix:
      resolveMatrix(sample.colorSpace.matrix, trackColorSpace?.matrix ?? null) ?? "bt2020-ncl",
    fullRange: sample.colorSpace.fullRange ?? trackColorSpace?.fullRange ?? false,
    bitDepth: desc.bitDepth,
  };

  const glr = WebglToneMap.create({ transfer, toneMap: grade.toneMap });
  if (!glr) return { reason: "WebGL2 is unavailable." };
  if (!glr.configureSource(desc, layout, width, height)) {
    glr.dispose();
    return { reason: "the YUV shader failed to build." };
  }

  let buffer: Uint8Array;
  let data: PlaneData;
  try {
    buffer = new Uint8Array(sample.allocationSize());
    const layouts = await sample.copyTo(buffer);
    data = makePlaneData(buffer, layouts, desc, width, height);
  } catch (e) {
    glr.dispose();
    return { reason: `reading raw frame data failed (${e instanceof Error ? e.message : String(e)}).` };
  }

  // The gate: the GPU must reproduce the TypeScript maths on this real frame.
  const check = glr.verifyAgainstReference(data);
  if (!check.ok) {
    glr.dispose();
    return { reason: `the GPU pipeline failed verification — ${check.detail}.` };
  }
  console.info(`reframe: ${check.detail}`);

  return {
    renderer: new RawPlaneRenderer(
      glr, doc.target, grade, desc, width, height, buffer, transfer, formatName!,
    ),
  };
}

/**
 * Pick the renderer for this export. The raw-plane path is chosen by the
 * SOURCE (HDR transfer + verified raw access), never by the presence of a
 * grade — SDR sources always take the identical-to-before 2D path.
 * `toneMap: "none"` is the documented restoration of the old behaviour.
 */
export async function createFrameRenderer(opts: {
  doc: ReframeDoc;
  /** The first decoded sample, for format detection + verification. Not closed here. */
  sample: VideoSample;
  /** The track's colr box, via `videoTrack.getColorSpace()`. */
  colorSpace: VideoColorSpaceInit | null;
  onNotice?: (message: string) => void;
}): Promise<FrameRenderer> {
  const { doc, sample, colorSpace, onNotice } = opts;
  const grade = gradeOf(doc);
  // lib.dom types transfer too narrowly to compare against "hlg"/"pq".
  const transfer = (colorSpace?.transfer ?? null) as string | null;
  const isHdr = transfer === "hlg" || transfer === "pq";

  if (isHdr && grade.toneMap !== "none") {
    const attempt = await tryRawPlaneRenderer(doc, sample, colorSpace, transfer, grade);
    if ("renderer" in attempt) return attempt.renderer;
    onNotice?.(
      `HDR source: ${attempt.reason} The export falls back to the browser's own tone mapping (flatter colour).`,
    );
  }

  return new Canvas2dRenderer(doc.target, grade);
}

/**
 * Text-only diagnosis of the HDR pipeline against a real file, for the
 * `?debug=1` panel: frame format, colour metadata, copyTo layout, and the
 * outcome of the real renderer cascade. One screenshot of this settles what
 * any browser actually does.
 */
export async function diagnoseHdrExport(file: File): Promise<string[]> {
  const lines: string[] = [];
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return ["No video track."];
    const colorSpace = await track.getColorSpace().catch(() => null);
    const hdr = await track.hasHighDynamicRange().catch(() => false);
    lines.push(`track colr box: ${JSON.stringify(colorSpace)} · HDR: ${hdr}`);

    const sink = new VideoSampleSink(track);
    const sample = await sink.getSample(0);
    if (!sample) {
      lines.push("Could not decode frame 0.");
      return lines;
    }
    try {
      lines.push(
        `frame 0: format=${sample.format ?? "null"} · coded ${sample.codedWidth}×${sample.codedHeight} · display ${sample.displayWidth}×${sample.displayHeight} · rotation ${sample.rotation}°`,
      );
      lines.push(`frame colour tag: ${JSON.stringify(sample.colorSpace.toJSON())}`);

      if (sample.format && parsePixelFormat(sample.format)) {
        try {
          const buffer = new Uint8Array(sample.allocationSize());
          const layouts = await sample.copyTo(buffer);
          lines.push(
            `copyTo: ok · ${buffer.byteLength} bytes · planes ${layouts
              .map((l, i) => `#${i}@${l.offset}·stride${l.stride}`)
              .join(" ")}`,
          );
        } catch (e) {
          lines.push(`copyTo FAILED: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        lines.push("copyTo: not attempted — format is null or RGB.");
      }

      // Run the real cascade with a throwaway document.
      const doc = createDoc({
        width: sample.displayWidth,
        height: sample.displayHeight,
        duration: 1,
        name: file.name,
        hdr,
      });
      const notices: string[] = [];
      const renderer = await createFrameRenderer({
        doc,
        sample,
        colorSpace,
        onNotice: (m) => notices.push(m),
      });
      lines.push(`chosen path: ${renderer.label}`);
      for (const n of notices) lines.push(`notice: ${n}`);
      renderer.dispose();
    } finally {
      sample.close();
    }
  } catch (e) {
    lines.push(`diagnosis failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    input.dispose();
  }
  return lines;
}
