"use client";

import * as React from "react";
import { gradeOf, type ReframeDoc } from "@/lib/reframe/model";
import { solveCrop } from "@/lib/reframe/solve";
import { cssGradeFilter } from "@/lib/reframe/tonemap";

interface Props {
  doc: ReframeDoc;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Changes here force a redraw while paused. */
  currentTime: number;
  /** While playing, the canvas is driven by an animation loop instead. */
  playing: boolean;
  className?: string;
}

/**
 * Live WYSIWYG of the exported 9:16 frame, drawn from the same `<video>`
 * element the stage shows. It uses the exact same {@link solveCrop} the
 * exporter uses, so what you see here is what lands in the MP4.
 */
export function ReframePreview({ doc, videoRef, currentTime, playing, className }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  // Read the doc through a ref inside the animation loop so the loop doesn't
  // have to be torn down and rebuilt on every keyframe edit.
  const docRef = React.useRef(doc);
  // Presentation time of the frame currently on the canvas. Every draw is
  // solved against this, so the crop can never disagree with the pixels.
  const presentedRef = React.useRef<number | null>(null);

  /**
   * `atTime` is the presentation time of the frame `drawImage` is about to
   * copy. Everything else falls back to the last frame presented, and only to
   * `video.currentTime` when no frame has been seen at all.
   *
   * The distinction is the whole game here. `video.currentTime` is the
   * playback position, which runs ahead of the picture — by the pipeline's
   * latency in general, by a whole seek across a segment cut. Drawing some
   * frames against one clock and some against the other put two different crop
   * positions on the canvas on alternate frames, which read as a shake.
   */
  const draw = React.useCallback((atTime?: number) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const d = docRef.current;
    if (!canvas || !video || video.readyState < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const crop = solveCrop(d, atTime ?? presentedRef.current ?? video.currentTime);
    // The video element's intrinsic size is the ground truth for drawImage;
    // rescale in case it disagrees with the probed display size.
    const sx = video.videoWidth / d.source.width;
    const sy = video.videoHeight / d.source.height;

    // The grade's post-OETF stage, previewed as a canvas filter. No editor
    // control writes a grade any more (HDR is tone-mapped automatically), so
    // this is a no-op unless a loaded document carries one — which the format
    // still supports. Contrast and saturation match the export exactly (same
    // formulas); exposure is only an approximation on HDR, because here it
    // multiplies pixels the browser has already tone-mapped instead of linear
    // light. The tone-map operator itself cannot be previewed at all: this
    // canvas draws the <video> element, whose pixels are already converted —
    // running the shader on them would be nonsense. ctx.filter is context
    // state and leaks, so it is always reset.
    const filter = cssGradeFilter(gradeOf(d));
    if (filter) ctx.filter = filter;
    ctx.drawImage(
      video,
      crop.x * sx,
      crop.y * sy,
      crop.width * sx,
      crop.height * sy,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    if (filter) ctx.filter = "none";
  }, [videoRef]);

  // Redraw when the browser presents a frame — playing or not, since a seek
  // presents one too. Nothing fires while the picture is unchanged, so this
  // costs nothing while paused and matches the video's rate while playing
  // rather than the display's.
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !("requestVideoFrameCallback" in video)) return;

    let handle = 0;
    let cancelled = false;
    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (cancelled) return;
      presentedRef.current = metadata.mediaTime;
      draw(metadata.mediaTime);
      handle = video.requestVideoFrameCallback(onFrame);
    };
    handle = video.requestVideoFrameCallback(onFrame);

    return () => {
      cancelled = true;
      video.cancelVideoFrameCallback(handle);
    };
  }, [draw, videoRef]);

  // Firefox has no frame callback: fall back to the display-rate loop while
  // playing, which can only ever be as accurate as `video.currentTime`.
  React.useEffect(() => {
    const video = videoRef.current;
    if (!playing || !video || "requestVideoFrameCallback" in video) return;
    let frame = 0;
    const tick = () => {
      draw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draw, playing, videoRef]);

  // While paused, redraw when the frame actually arrives. A seek is async, so
  // drawing only on the currentTime change would show the previous frame.
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const redraw = () => draw();
    video.addEventListener("seeked", redraw);
    return () => video.removeEventListener("seeked", redraw);
  }, [draw, videoRef]);

  // Publish the latest doc to the loop, and redraw immediately on an edit so
  // reframing updates the preview without waiting for a seek.
  React.useEffect(() => {
    docRef.current = doc;
    draw();
  }, [draw, currentTime, doc]);

  return (
    <canvas
      ref={canvasRef}
      // Backing store is capped for preview cost; the export renders at full
      // target resolution.
      width={Math.min(doc.target.width, 405)}
      height={Math.round(Math.min(doc.target.width, 405) / (doc.target.width / doc.target.height))}
      className={className}
      style={{ aspectRatio: `${doc.target.width} / ${doc.target.height}` }}
    />
  );
}
