"use client";

import * as React from "react";
import { useRafCoalesce } from "@/lib/hooks/use-raf-coalesce";
import { clamp } from "@/lib/reframe/model";

interface Props {
  /** Full length of the clip, in seconds. The track spans all of it. */
  duration: number;
  /** Where this clip's video actually is. */
  time: number;
  start: number;
  end: number;
  /** Alignment nudge, drawn as the shifted range along the bottom. */
  offset: number;
  onScrub: (t: number) => void;
  onMoveStart: (t: number) => void;
  onMoveEnd: (t: number) => void;
  /**
   * Fires once on pointer-down, before the first update, so that dragging a
   * marker is a single undo step rather than one per animation frame.
   */
  onGestureStart?: (kind: Grab) => void;
  /** Fires on pointer-up, with the kind of gesture that just ended. */
  onGestureEnd?: (kind: Grab) => void;
}

/** How close to a marker the pointer must land to grab it instead of scrubbing. */
const GRAB_PX = 10;

export type Grab = "scrub" | "start" | "end";

/**
 * One clip's own track, spanning its whole duration.
 *
 * Deliberately independent of the master timeline: once the ranges are tight,
 * the master maps a second of one clip onto a second of the other, which is far
 * too coarse to hunt down a contact frame in a 20-second clip. This is where
 * that hunting happens.
 */
export function CompareScrub({
  duration,
  time,
  start,
  end,
  offset,
  onScrub,
  onMoveStart,
  onMoveEnd,
  onGestureStart,
  onGestureEnd,
}: Props) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const grabRef = React.useRef<Grab | null>(null);
  const { schedule, flush } = useRafCoalesce();

  const pct = (t: number) => `${duration > 0 ? (clamp(t, 0, duration) / duration) * 100 : 0}%`;

  const timeAt = React.useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
    },
    [duration],
  );

  const apply = React.useCallback(
    (grab: Grab, t: number) => {
      if (grab === "start") onMoveStart(t);
      else if (grab === "end") onMoveEnd(t);
      else onScrub(t);
    },
    [onMoveStart, onMoveEnd, onScrub],
  );

  const handleDown = (e: React.PointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || duration <= 0) return;
    // Capture on the track, not on the markers: a marker moves out from under
    // the pointer as it is dragged, and the drag would end the moment it did.
    e.currentTarget.setPointerCapture(e.pointerId);

    const x = e.clientX - rect.left;
    const px = (t: number) => (clamp(t, 0, duration) / duration) * rect.width;
    const dStart = Math.abs(x - px(start));
    const dEnd = Math.abs(x - px(end));
    const grab: Grab =
      Math.min(dStart, dEnd) > GRAB_PX ? "scrub" : dStart <= dEnd ? "start" : "end";

    grabRef.current = grab;
    onGestureStart?.(grab);
    apply(grab, timeAt(e.clientX));
  };

  const handleMove = (e: React.PointerEvent) => {
    const grab = grabRef.current;
    if (!grab) return;
    // Read the coordinate now: React recycles the event before the frame runs.
    const { clientX } = e;
    schedule(() => apply(grab, timeAt(clientX)));
  };

  const endDrag = (e: React.PointerEvent) => {
    const grab = grabRef.current;
    if (!grab) return;
    flush();
    grabRef.current = null;
    onGestureEnd?.(grab);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      ref={trackRef}
      className="relative h-8 w-full select-none overflow-hidden rounded-small bg-surface touch-none cursor-pointer"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* The marked range. */}
      <div
        className="absolute inset-y-0 bg-accent-muted"
        style={{ left: pct(start), width: pct(end - start) }}
      />

      {/* What the nudge actually samples, when it differs from the markers. */}
      {offset !== 0 && (
        <div
          className="absolute bottom-0 h-1 bg-accent/50"
          style={{ left: pct(start + offset), width: pct(end - start) }}
        />
      )}

      <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent" style={{ left: pct(start) }} />
      <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent" style={{ left: pct(end) }} />

      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-text-primary"
        style={{ left: pct(time) }}
      />
    </div>
  );
}
