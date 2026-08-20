"use client";

import * as React from "react";
import type { ReframeDoc } from "@/lib/reframe/model";
import { solveCrop } from "@/lib/reframe/solve";

interface Props {
  doc: ReframeDoc;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Changes here force a redraw while paused. */
  currentTime: number;
  className?: string;
}

/**
 * Live WYSIWYG of the exported 9:16 frame, drawn from the same `<video>`
 * element the stage shows. It uses the exact same {@link solveCrop} the
 * exporter uses, so what you see here is what lands in the MP4.
 */
export function ReframePreview({ doc, videoRef, currentTime, className }: Props) {
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
  }, [videoRef]);

  // One rAF loop for the lifetime of the preview: cheap, and it keeps the
  // canvas in step with playback without relying on `timeupdate` (which only
  // fires ~4×/second).
  React.useEffect(() => {
    let frame = 0;
    const tick = () => {
      draw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draw]);

  // Publish the latest doc to the loop, and redraw immediately after a seek
  // or an edit so the preview updates while paused.
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
