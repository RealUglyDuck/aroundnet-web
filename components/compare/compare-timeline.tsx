"use client";

import * as React from "react";
import { useRafCoalesce } from "@/lib/hooks/use-raf-coalesce";
import { clamp } from "@/lib/reframe/model";
import {
  frameDuration,
  masterDuration,
  referenceClip,
  type CompareDoc,
} from "@/lib/compare/model";

interface Props {
  doc: CompareDoc;
  /** Master position, 0 → 1. */
  u: number;
  onScrub: (u: number) => void;
}

/** Label spacings to choose from, in reference seconds. */
const STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30];
const MIN_LABEL_PX = 72;
/** Below this, per-frame ticks are noise rather than a ruler. */
const MIN_FRAME_TICK_PX = 5;

/**
 * The master timeline: one playhead over both clips, in reference-clip seconds.
 *
 * It is short by nature — a serve is a second or two — so unlike the reframe
 * timeline there is no zoom. Instead it draws a tick per reference frame when
 * they are far enough apart to see, which is the scale frame-stepping works at.
 */
export function CompareTimeline({ doc, u, onScrub }: Props) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);
  const { schedule, flush } = useRafCoalesce();
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const duration = masterDuration(doc);
  const ref = referenceClip(doc);

  const uAt = React.useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }, []);

  const handleDown = (e: React.PointerEvent) => {
    if (duration <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    onScrub(uAt(e.clientX));
  };

  const handleMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const { clientX } = e;
    schedule(() => onScrub(uAt(clientX)));
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    flush();
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const step =
    duration > 0 && width > 0
      ? (STEPS.find((s) => (s / duration) * width >= MIN_LABEL_PX) ?? STEPS[STEPS.length - 1])
      : 0;

  const labels: number[] = [];
  if (step > 0) {
    for (let t = 0; t <= duration + 1e-6; t += step) labels.push(t);
  }

  const frame = ref ? frameDuration(ref) : 0;
  const frameTicks: number[] = [];
  if (frame > 0 && duration > 0 && width > 0 && (frame / duration) * width >= MIN_FRAME_TICK_PX) {
    for (let t = 0; t <= duration + 1e-6; t += frame) frameTicks.push(t);
  }

  return (
    <div
      ref={trackRef}
      className="relative h-14 w-full select-none overflow-hidden rounded-card bg-surface touch-none cursor-pointer"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {frameTicks.map((t, i) => (
        <div
          key={`f${i}`}
          className="absolute bottom-0 top-6 w-px bg-divider"
          style={{ left: `${(t / duration) * 100}%` }}
        />
      ))}

      {labels.map((t, i) => (
        <div
          key={`l${i}`}
          className="absolute inset-y-0 border-l border-divider"
          style={{ left: `${duration > 0 ? (t / duration) * 100 : 0}%` }}
        >
          <span className="absolute left-1 top-1 text-[10px] tabular-nums text-text-secondary">
            {t.toFixed(step < 1 ? 2 : 1)}s
          </span>
        </div>
      ))}

      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-accent"
        style={{ left: `${clamp(u, 0, 1) * 100}%` }}
      >
        <div className="absolute -left-1 top-0 h-2 w-2 rounded-full bg-accent" />
      </div>

      {duration <= 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-text-secondary">
          Load a clip to get a timeline.
        </p>
      )}
    </div>
  );
}
