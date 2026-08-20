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
  EncodedPacketSink,
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
import type { ReframeDoc } from "./model.ts";
import { cropTransform, solveCrop } from "./solve.ts";

export type ExportQuality = "low" | "medium" | "high" | "veryHigh";

const QUALITY_MAP: Record<ExportQuality, Quality> = {
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  veryHigh: QUALITY_VERY_HIGH,
};

export interface ExportProgress {
  /** 0–1, based on how far through the source timeline we are. */
  fraction: number;
  framesRendered: number;
  /** Which stage is running, for the UI label. */
  stage: "video" | "audio" | "finalizing";
}

export interface ExportOptions {
  doc: ReframeDoc;
  file: File;
  quality?: ExportQuality;
  /** Copy the source audio track across. Default true. */
  includeAudio?: boolean;
  /** Render only part of the source, in seconds. Defaults to the whole video. */
  trim?: { start: number; end: number };
  onProgress?: (progress: ExportProgress) => void;
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
  trim,
  onProgress,
  signal,
}: ExportOptions): Promise<Blob> {
  const start = Math.max(0, trim?.start ?? 0);
  const end = Math.min(doc.source.duration, trim?.end ?? doc.source.duration);
  if (!(end > start)) throw new Error("Export range is empty.");
  const span = end - start;

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

    // Audio is only copied when the source codec is legal inside MP4 (AAC,
    // MP3, …). Anything else — Opus in a WebM, say — is dropped rather than
    // silently transcoded.
    const audioTrack = includeAudio ? await input.getPrimaryAudioTrack() : null;
    const audioCodec = audioTrack ? await audioTrack.getCodec() : null;
    const audioSupported =
      !!audioCodec && output.format.getSupportedCodecs().includes(audioCodec);
    const audioSource =
      audioTrack && audioSupported && audioCodec
        ? new EncodedAudioPacketSource(audioCodec)
        : null;
    if (audioSource) output.addAudioTrack(audioSource);

    await output.start();

    /* ── Video: decode → crop → encode ──────────────────────────────── */
    const sink = new VideoSampleSink(videoTrack);
    let framesRendered = 0;

    // The output must start at zero, so everything is rebased. The offset
    // can't just be `start`: containers routinely carry a small composition
    // or edit-list offset, so the first frame may sit slightly *before* the
    // requested time (a track starting at -0.0015s is common), and a trimmed
    // export begins on the last frame at or before the in-point. Both tracks
    // share one offset, which keeps A/V sync exact.
    let timeOffset: number | null = null;

    for await (const sample of sink.samples(start, end)) {
      try {
        throwIfAborted(signal);
        if (timeOffset === null) timeOffset = Math.min(sample.timestamp, start);
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
        await videoSource.add(Math.max(0, sample.timestamp - timeOffset), sample.duration);
        framesRendered += 1;
        onProgress?.({
          fraction: Math.min(1, (sample.timestamp - start) / span),
          framesRendered,
          stage: "video",
        });
      } finally {
        sample.close();
      }
    }
    videoSource.close();

    /* ── Audio: straight packet copy ────────────────────────────────── */
    if (audioSource && audioTrack) {
      onProgress?.({ fraction: 1, framesRendered, stage: "audio" });
      const decoderConfig = await audioTrack.getDecoderConfig();
      if (!decoderConfig) throw new Error("Could not read the audio decoder config.");

      const packetSink = new EncodedPacketSink(audioTrack);
      // Start from the key packet at or before `start` so the decoder has
      // everything it needs; packets fully before the in-point are dropped.
      const startPacket = await packetSink.getKeyPacket(start);
      const offset = timeOffset ?? start;
      let isFirst = true;

      for await (const packet of packetSink.packets(startPacket ?? undefined)) {
        throwIfAborted(signal);
        if (packet.timestamp >= end) break;
        if (packet.timestamp + packet.duration <= offset) continue;
        // A packet straddling the in-point is kept but pinned to zero rather
        // than going negative, which the muxer rejects.
        const shifted = Math.max(0, packet.timestamp - offset);
        await audioSource.add(
          shifted === packet.timestamp ? packet : packet.clone({ timestamp: shifted }),
          isFirst ? { decoderConfig } : undefined,
        );
        isFirst = false;
      }
      audioSource.close();
    }

    onProgress?.({ fraction: 1, framesRendered, stage: "finalizing" });
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

/** Suggests `clip.mp4` → `clip-9x16.mp4`. */
export function suggestedFilename(doc: ReframeDoc): string {
  const base = doc.source.name.replace(/\.[^.]+$/, "") || "reframed";
  const ratio = `${doc.target.width}x${doc.target.height}`;
  return `${base}-${ratio}.mp4`;
}
