/**
 * Renders a {@link ReframeDoc} to a real MP4, entirely in the browser.
 *
 * Pipeline: mediabunny demuxes the source and hands us decoded frames via
 * WebCodecs → each frame is drawn through its crop rect onto a target-sized
 * canvas → the canvas is re-encoded (AVC) and muxed into MP4. The audio track
 * is copied packet-for-packet rather than decoded and re-encoded, so it costs
 * nothing and loses no quality.
 *
 * Everything is hardware-accelerated where the browser allows, so this runs
 * faster than real time on typical footage.
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  VideoSampleSink,
  canEncodeVideo,
  type Quality,
} from "mediabunny";
import { clamp, exportRanges, minSegmentDuration, type ReframeDoc } from "./model.ts";
import { cropTransform, solveCrop } from "./solve.ts";
import {
  copyAudioPackets,
  createReelAudioSource,
  encodeAudioReel,
  planAudio,
  type ExportRange,
} from "./export-audio.ts";

export type ExportQuality = "low" | "medium" | "high" | "veryHigh";

const QUALITY_MAP: Record<ExportQuality, Quality> = {
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  veryHigh: QUALITY_VERY_HIGH,
};

export interface ExportProgress {
  /** 0–1 across the summed duration of every range being rendered. */
  fraction: number;
  framesRendered: number;
  /** Which stage is running, for the UI label. */
  stage: "video" | "audio" | "finalizing";
  /** 1-based index of the range being rendered, and how many there are. */
  segmentIndex: number;
  segmentCount: number;
}

export interface ExportOptions {
  doc: ReframeDoc;
  file: File;
  quality?: ExportQuality;
  /** Keep the source audio. Default true. */
  includeAudio?: boolean;
  /**
   * Ranges to render, in seconds, joined end to end into one output. Defaults
   * to the document's segments, or the whole clip when it has none.
   */
  ranges?: ExportRange[];
  /** Render a single sub-range. Superseded by `ranges`. */
  trim?: ExportRange;
  onProgress?: (progress: ExportProgress) => void;
  /** Non-fatal notices, e.g. audio being dropped for an unsupported codec. */
  onNotice?: (message: string) => void;
  signal?: AbortSignal;
}

export class ExportCanceledError extends Error {
  constructor() {
    super("Export canceled.");
  }
}

/** Reports whether this browser can run the export at all, and why not. */
export async function checkExportSupport(): Promise<{ ok: boolean; reason?: string }> {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") {
    return { ok: false, reason: "This browser doesn't support WebCodecs (needs Chrome, Edge, or Safari 16.4+)." };
  }
  if (typeof OffscreenCanvas === "undefined") {
    return { ok: false, reason: "This browser doesn't support OffscreenCanvas." };
  }
  // 1080×1920 AVC is the default export target; if the browser can't encode
  // it there is no point letting the user start a five-minute render.
  const ok = await canEncodeVideo("avc", { width: 1080, height: 1920 });
  return ok ? { ok: true } : { ok: false, reason: "This browser can't encode H.264 video." };
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new ExportCanceledError();
}

export async function exportReframedVideo({
  doc,
  file,
  quality = "high",
  includeAudio = true,
  ranges,
  trim,
  onProgress,
  onNotice,
  signal,
}: ExportOptions): Promise<Blob> {
  const duration = doc.source.duration;
  const minRange = minSegmentDuration(doc);
  const requested = ranges ?? (trim ? [trim] : exportRanges(doc));
  const resolved = requested
    .map((r) => ({
      start: clamp(Math.min(r.start, r.end), 0, duration),
      end: clamp(Math.max(r.start, r.end), 0, duration),
    }))
    .filter((r) => r.end - r.start >= minRange)
    .sort((a, b) => a.start - b.start);
  if (resolved.length === 0) throw new Error("Export range is empty.");

  const totalSpan = resolved.reduce((sum, r) => sum + (r.end - r.start), 0);
  const fps = doc.source.frameRate || 30;

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({
    // fastStart puts the moov atom up front so the file is seekable and
    // previewable the instant it lands, rather than after a full download.
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error("The source file has no video track.");

    const canvas = new OffscreenCanvas(doc.target.width, doc.target.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not create a 2D canvas context.");
    ctx.imageSmoothingQuality = "high";

    const videoSource = new CanvasSource(canvas, {
      codec: "avc",
      quality: QUALITY_MAP[quality],
      keyFrameInterval: 2,
    });
    output.addVideoTrack(videoSource, {
      frameRate: doc.source.frameRate,
      // Frames are drawn upright onto the canvas; any source rotation has
      // already been applied by VideoSample.draw, so the output has none.
      rotation: 0,
    });

    const audioTrack = includeAudio ? await input.getPrimaryAudioTrack() : null;
    const plan = await planAudio(audioTrack, output.format.getSupportedCodecs(), resolved.length);
    if (plan.kind === "none" && plan.reason) onNotice?.(plan.reason);

    const copySource = plan.kind === "copy" ? new EncodedAudioPacketSource(plan.codec) : null;
    const reelSource = plan.kind === "reencode" ? createReelAudioSource() : null;
    if (copySource) output.addAudioTrack(copySource);
    if (reelSource) output.addAudioTrack(reelSource);

    await output.start();

    /* ── Video: decode → crop → encode, one range after another ─────── */
    const sink = new VideoSampleSink(videoTrack);
    let framesRendered = 0;
    let outOffset = 0;

    for (const [index, range] of resolved.entries()) {
      const span = range.end - range.start;
      let firstInRange = true;

      for await (const sample of sink.samples(range.start, range.end)) {
        try {
          throwIfAborted(signal);

          // samples() yields the frame *covering* range.start, whose timestamp
          // is before it. Clamping to 0 pins that frame to the join and keeps
          // output timestamps non-decreasing, which the muxer asserts.
          const local = Math.max(0, sample.timestamp - range.start);
          const outTs = outOffset + local;

          const crop = solveCrop(doc, sample.timestamp);

          // The crop is expressed against the probed source dimensions, but the
          // decoded sample is the ground truth — rescale if they disagree. The
          // on-screen preview does the same against the video element, which is
          // why it can look right while an unscaled export does not.
          const scaleX = sample.displayWidth / doc.source.width;
          const scaleY = sample.displayHeight / doc.source.height;
          const scaled = {
            x: crop.x * scaleX,
            y: crop.y * scaleY,
            width: crop.width * scaleX,
            height: crop.height * scaleY,
          };

          // Crop via a canvas transform that maps the crop rect onto the whole
          // canvas, then draw the frame whole. This uses draw()'s plain
          // destination-only path — the same shape as the preview's drawImage —
          // instead of its source-rect overload, while still letting mediabunny
          // apply any rotation metadata.
          const t = cropTransform(scaled, doc.target);
          ctx.save();
          ctx.setTransform(t.scaleX, 0, 0, t.scaleY, t.translateX, t.translateY);
          sample.draw(ctx, 0, 0, sample.displayWidth, sample.displayHeight);
          ctx.restore();

          await videoSource.add(
            outTs,
            Math.max(1 / fps / 4, Math.min(sample.duration || 1 / fps, span - local)),
            // The frame after a cut has nothing in common with the one before
            // it, so a P-frame there smears. keyFrame is a hint, but encoders
            // honour it in practice.
            firstInRange ? { keyFrame: true } : undefined,
          );
          firstInRange = false;
          framesRendered += 1;
          onProgress?.({
            fraction: Math.min(1, outTs / totalSpan),
            framesRendered,
            stage: "video",
            segmentIndex: index + 1,
            segmentCount: resolved.length,
          });
        } finally {
          sample.close();
        }
      }
      outOffset += span;
    }
    videoSource.close();

    /* ── Audio ──────────────────────────────────────────────────────── */
    if (audioTrack && (copySource || reelSource)) {
      onProgress?.({
        fraction: 1,
        framesRendered,
        stage: "audio",
        segmentIndex: resolved.length,
        segmentCount: resolved.length,
      });
      const abort = () => throwIfAborted(signal);
      if (copySource) {
        await copyAudioPackets({
          audioTrack,
          audioSource: copySource,
          range: resolved[0],
          timeOffset: resolved[0].start,
          throwIfAborted: abort,
        });
        copySource.close();
      } else if (reelSource) {
        await encodeAudioReel({
          audioTrack,
          audioSource: reelSource,
          ranges: resolved,
          throwIfAborted: abort,
        });
        reelSource.close();
      }
    }

    onProgress?.({
      fraction: 1,
      framesRendered,
      stage: "finalizing",
      segmentIndex: resolved.length,
      segmentCount: resolved.length,
    });
    await output.finalize();

    const buffer = output.target.buffer;
    if (!buffer) throw new Error("Export produced no data.");
    return new Blob([buffer], { type: "video/mp4" });
  } catch (error) {
    if (output.state === "started" || output.state === "pending") {
      await output.cancel().catch(() => {});
    }
    throw error;
  } finally {
    input.dispose();
  }
}

/** Suggests `clip.mp4` → `clip-1080x1920-reel.mp4`. */
export function suggestedFilename(doc: ReframeDoc): string {
  const base = doc.source.name.replace(/\.[^.]+$/, "") || "reframed";
  const ratio = `${doc.target.width}x${doc.target.height}`;
  const reel = doc.segments.length > 1 ? "-reel" : "";
  return `${base}-${ratio}${reel}.mp4`;
}
