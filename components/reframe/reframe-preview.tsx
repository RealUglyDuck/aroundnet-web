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

  const draw = React.useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const d = docRef.current;
    if (!canvas || !video || video.readyState < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const crop = solveCrop(d, video.currentTime);
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

  // Only loop while playing. Redrawing every frame forever costs real work for
  // nothing while paused, and it competes with scrubbing for the main thread.
  React.useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      draw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draw, playing]);

  // While paused, redraw when the frame actually arrives. A seek is async, so
  // drawing only on the currentTime change would show the previous frame.
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.addEventListener("seeked", draw);
    return () => video.removeEventListener("seeked", draw);
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
