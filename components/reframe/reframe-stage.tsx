"use client";

import * as React from "react";
import type { ReframeDoc } from "@/lib/reframe/model";
import { solveCropNormalised } from "@/lib/reframe/solve";

interface Props {
  doc: ReframeDoc;
  src: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Playhead time, only used to position the overlay. */
  currentTime: number;
  /** Called with normalised source coordinates on tap and on drag. */
  onPick: (cx: number, cy: number) => void;
  /** Fires when the pointer lifts, so a drag can be treated as one edit. */
  onPickEnd?: () => void;
  onLoadedMetadata?: () => void;
  onEnded?: () => void;
}

/**
 * How tall the source frame is allowed to get. Without a cap, `aspect-ratio`
 * on a full-width box makes vertical footage taller than the window — a 9:16
 * clip in a 900px column is 1600px tall — pushing the transport and timeline
 * off screen. Capping the height and letting the width follow keeps the whole
 * frame and the controls visible at once.
 *
 * 60vh rather than more: the transport row, hint line and timeline below need
 * roughly 250px, so on a laptop this is what fits without scrolling. It only
 * binds on tall footage — 16:9 in a full-width column is already shorter.
 */
const MAX_STAGE_HEIGHT = "60vh";

/**
 * The full source frame with the output window drawn on top.
 *
 * Tapping anywhere re-centres the window on that point (the solver pulls it
 * back to the edge when the tap is near the side); dragging keeps re-centring
 * so you can nudge the framing without hunting for the exact pixel.
 */
export function ReframeStage({
  doc,
  src,
  videoRef,
  currentTime,
  onPick,
  onPickEnd,
  onLoadedMetadata,
  onEnded,
}: Props) {
  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const crop = solveCropNormalised(doc, currentTime);

  const pick = React.useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      onPick((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height);
    },
    [onPick],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    pick(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    pick(e.clientX, e.clientY);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    onPickEnd?.();
  };

  const pct = (v: number) => `${v * 100}%`;

  return (
    <div
      ref={surfaceRef}
      className="relative mx-auto w-full overflow-hidden rounded-card bg-black touch-none select-none cursor-crosshair"
      style={{
        aspectRatio: `${doc.source.width} / ${doc.source.height}`,
        // Width, not height, is capped: `aspect-ratio` derives height from a
        // definite width, so a max-height alone would stretch the box instead
        // of shrinking it. This makes the width min(100%, cap × ratio), and
        // the ratio then keeps the height within the cap.
        maxWidth: `calc(${MAX_STAGE_HEIGHT} * ${doc.source.width} / ${doc.source.height})`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <video
        ref={videoRef}
        src={src}
        className="absolute inset-0 h-full w-full pointer-events-none"
        playsInline
        preload="auto"
        onLoadedMetadata={onLoadedMetadata}
        onEnded={onEnded}
      />

      {/* The output window. The huge box-shadow dims everything outside it. */}
      <div
        className="absolute border-2 border-accent pointer-events-none transition-[border-color]"
        style={{
          left: pct(crop.x),
          top: pct(crop.y),
          width: pct(crop.width),
          height: pct(crop.height),
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.58)",
        }}
      >
        {/* Centre crosshair — the point a tap would place under your finger. */}
        <div className="absolute left-1/2 top-1/2 h-5 w-px -translate-x-1/2 -translate-y-1/2 bg-accent/70" />
        <div className="absolute left-1/2 top-1/2 h-px w-5 -translate-x-1/2 -translate-y-1/2 bg-accent/70" />
        {/* Rule-of-thirds guides. */}
        <div className="absolute inset-x-0 top-1/3 h-px bg-white/15" />
        <div className="absolute inset-x-0 top-2/3 h-px bg-white/15" />
      </div>
    </div>
  );
}
