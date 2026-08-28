"use client";

import * as React from "react";

export interface RafCoalesce {
  /** Queue `fn` to run on the next animation frame, replacing any queued one. */
  schedule: (fn: () => void) => void;
  /** Run the queued update now. Call on pointer-up. */
  flush: () => void;
}

/**
 * Coalesce a stream of updates down to one per animation frame.
 *
 * `pointermove` fires far faster than the display refreshes — a high-polling-
 * rate mouse easily exceeds 500Hz — and in a video tool each update re-renders
 * and assigns `video.currentTime`, which forces a decode. Coalescing is the
 * difference between a smooth scrub and a queue of seeks the browser can never
 * catch up with.
 *
 * `flush` exists because the *last* move of a drag is the one that matters: it
 * is the position the gesture committed to, and dropping it leaves the playhead
 * a frame short of where the pointer was released.
 *
 * Read the values you need off the event *before* calling `schedule` — React
 * recycles synthetic events, so `e.clientX` is not there by the time the queued
 * callback runs.
 */
export function useRafCoalesce(): RafCoalesce {
  const frameRef = React.useRef<number | null>(null);
  const pendingRef = React.useRef<(() => void) | null>(null);

  const schedule = React.useCallback((fn: () => void) => {
    pendingRef.current = fn;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const run = pendingRef.current;
      pendingRef.current = null;
      run?.();
    });
  }, []);

  const flush = React.useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const run = pendingRef.current;
    pendingRef.current = null;
    run?.();
  }, []);

  React.useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return React.useMemo(() => ({ schedule, flush }), [schedule, flush]);
}
