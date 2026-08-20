"use client";

import * as React from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReframeDoc, ReframeKeyframe } from "@/lib/reframe/model";
import { formatTimecode } from "@/lib/reframe/format";

interface Props {
  doc: ReframeDoc;
  currentTime: number;
  selectedId: string | null;
  onSeek: (t: number) => void;
  onSelect: (id: string | null) => void;
  onMoveKeyframe: (id: string, t: number) => void;
}

/** Roughly one label every 90px, snapped to a human-friendly interval. */
function tickInterval(visibleDuration: number, widthPx: number): number {
  const target = visibleDuration / Math.max(2, Math.floor(widthPx / 90));
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s >= target) ?? 900;
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function ReframeTimeline({
  doc,
  currentTime,
  selectedId,
  onSeek,
  onSelect,
  onMoveKeyframe,
}: Props) {
  const duration = doc.source.duration;
  const fps = doc.source.frameRate || 30;
  // Don't let the user zoom past ~10 frames across the full width; below that
  // the ruler is all noise and there's nothing left to aim at.
  const minView = Math.min(duration, Math.max(0.2, 10 / fps));

  const trackRef = React.useRef<HTMLDivElement>(null);
  const overviewRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);

  /** The window of time the detail track shows. */
  const [view, setView] = React.useState({ start: 0, span: duration });
  // Pointer and native-wheel handlers need the current view without being
  // re-bound on every change, so it is mirrored into a ref.
  const viewRef = React.useRef(view);
  React.useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // A new video resets the view to the whole clip. Adjusting state during
  // render rather than in an effect avoids a frame showing the stale range.
  const [lastDuration, setLastDuration] = React.useState(duration);
  if (lastDuration !== duration) {
    setLastDuration(duration);
    setView({ start: 0, span: duration });
  }

  const setViewClamped = React.useCallback(
    (start: number, span: number) => {
      const nextSpan = clamp(span, minView, duration);
      const next = { start: clamp(start, 0, Math.max(0, duration - nextSpan)), span: nextSpan };
      viewRef.current = next;
      setView(next);
    },
    [duration, minView],
  );

  React.useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const zoomed = view.span < duration - 1e-6;

  /* ── Coordinate mapping ──────────────────────────────────────────────── */

  const timeAtDetail = React.useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const { start, span } = viewRef.current;
    return clamp(start + ((clientX - rect.left) / rect.width) * span, 0, duration);
  }, [duration]);

  const timeAtOverview = React.useCallback((clientX: number) => {
    const rect = overviewRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  }, [duration]);

  /** Position within the detail track, 0–1. May fall outside when off-screen. */
  const detailPct = (t: number) => (view.span > 0 ? (t - view.start) / view.span : 0);
  const overviewPct = (t: number) => (duration > 0 ? t / duration : 0);

  /* ── Keep the playhead in view ───────────────────────────────────────── */

  React.useEffect(() => {
    const { start, span } = viewRef.current;
    if (span >= duration) return;
    if (currentTime >= start && currentTime <= start + span) return;
    // Park the playhead 10% in from the left so playback has room to run
    // before the next scroll, instead of re-scrolling every frame.
    setViewClamped(currentTime - span * 0.1, span);
  }, [currentTime, duration, setViewClamped]);

  /* ── Zoom & pan on the detail track ──────────────────────────────────── */

  const zoomBy = React.useCallback(
    (factor: number, anchorRatio = 0.5) => {
      const { start, span } = viewRef.current;
      const anchorTime = start + span * anchorRatio;
      const nextSpan = clamp(span * factor, minView, duration);
      setViewClamped(anchorTime - anchorRatio * nextSpan, nextSpan);
    },
    [duration, minView, setViewClamped],
  );

  // Native listener: React's wheel handler is passive, so it can't
  // preventDefault, and the page would scroll while zooming.
  React.useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      const { start, span } = viewRef.current;

      if (e.ctrlKey || e.metaKey || (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX))) {
        e.preventDefault();
        const anchorRatio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        zoomBy(Math.exp(e.deltaY * 0.002), anchorRatio);
        return;
      }
      // Shift+wheel, or a trackpad's horizontal axis, pans.
      const delta = e.shiftKey ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      e.preventDefault();
      setViewClamped(start + (delta / rect.width) * span, span);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setViewClamped, zoomBy]);

  /* ── Detail track pointer handling ───────────────────────────────────── */

  const [scrubbing, setScrubbing] = React.useState(false);
  const draggingRef = React.useRef<string | null>(null);

  const handleDetailDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    onSeek(timeAtDetail(e.clientX));
  };

  const handleDetailMove = (e: React.PointerEvent) => {
    const draggingId = draggingRef.current;
    if (draggingId) {
      onMoveKeyframe(draggingId, timeAtDetail(e.clientX));
      return;
    }
    if (scrubbing) onSeek(timeAtDetail(e.clientX));
  };

  const endDetail = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    draggingRef.current = null;
    setScrubbing(false);
  };

  const startKeyframeDrag = (e: React.PointerEvent, kf: ReframeKeyframe) => {
    e.stopPropagation();
    // Capture on the track, not the marker: the marker moves out from under
    // the pointer as it is dragged.
    trackRef.current?.setPointerCapture(e.pointerId);
    draggingRef.current = kf.id;
    onSelect(kf.id);
    onSeek(kf.t);
  };

  /* ── Overview pointer handling ───────────────────────────────────────── */

  const panRef = React.useRef<{ grabOffset: number } | null>(null);

  const handleOverviewDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = timeAtOverview(e.clientX);
    const { start, span } = viewRef.current;
    if (zoomed && t >= start && t <= start + span) {
      // Grabbing the window itself pans without moving the playhead.
      panRef.current = { grabOffset: t - start };
    } else {
      panRef.current = null;
      onSeek(t);
    }
  };

  const handleOverviewMove = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const t = timeAtOverview(e.clientX);
    if (panRef.current) {
      setViewClamped(t - panRef.current.grabOffset, viewRef.current.span);
    } else {
      onSeek(t);
    }
  };

  const endOverview = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    panRef.current = null;
  };

  /* ── Ruler ───────────────────────────────────────────────────────────── */

  const interval = tickInterval(view.span, width || 800);
  const ticks: number[] = [];
  const firstTick = Math.ceil(view.start / interval) * interval;
  for (let t = firstTick; t <= view.start + view.span + 1e-6; t += interval) ticks.push(t);

  const first = doc.keyframes[0];
  const last = doc.keyframes[doc.keyframes.length - 1];
  const pct = (v: number) => `${v * 100}%`;

  return (
    <div className="select-none space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs text-text-secondary">
        <span className="font-mono text-accent">
          {formatTimecode(currentTime, doc.source.frameRate)}
        </span>
        <div className="flex items-center gap-1">
          <span className="mr-1 tabular-nums">
            {doc.keyframes.length} keyframe{doc.keyframes.length === 1 ? "" : "s"} ·{" "}
            {zoomed ? `${formatTimecode(view.span)} shown` : formatTimecode(duration)}
          </span>
          <TimelineButton onClick={() => zoomBy(1 / 1.8)} label="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </TimelineButton>
          <TimelineButton onClick={() => zoomBy(1.8)} label="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </TimelineButton>
          <TimelineButton
            onClick={() => setViewClamped(0, duration)}
            label="Fit whole clip"
            disabled={!zoomed}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </TimelineButton>
        </div>
      </div>

      {/* ── Detail track ───────────────────────────────────────────────── */}
      <div
        ref={trackRef}
        className="relative h-20 w-full cursor-pointer overflow-hidden rounded-card bg-surface touch-none"
        onPointerDown={handleDetailDown}
        onPointerMove={handleDetailMove}
        onPointerUp={endDetail}
        onPointerCancel={endDetail}
      >
        <div className="absolute inset-x-0 top-0 h-6 border-b border-divider">
          {ticks.map((t) => (
            <div key={t} className="absolute top-0 h-full" style={{ left: pct(detailPct(t)) }}>
              <div className="h-2 w-px bg-divider" />
              <span className="absolute left-1 top-1 whitespace-nowrap text-[10px] tabular-nums text-text-secondary">
                {formatTimecode(t, interval < 1 ? doc.source.frameRate : undefined)}
              </span>
            </div>
          ))}
        </div>

        {/* The animated span, so it's obvious where the pan is defined. */}
        {first && last && last.t > first.t && (
          <div
            className="absolute top-[52px] h-0.5 rounded-pill bg-accent/40"
            style={{
              left: pct(detailPct(first.t)),
              width: pct((last.t - first.t) / view.span),
            }}
          />
        )}

        {doc.keyframes.map((kf) => {
          const p = detailPct(kf.t);
          if (p < -0.02 || p > 1.02) return null;
          return (
            <button
              key={kf.id}
              type="button"
              aria-label={`Keyframe at ${formatTimecode(kf.t, doc.source.frameRate)}`}
              className="absolute top-[53px] -ml-[7px] h-3.5 w-3.5 rotate-45 rounded-[2px] transition-colors"
              style={{ left: pct(p) }}
              onPointerDown={(e) => startKeyframeDrag(e, kf)}
            >
              <span
                className={cn(
                  "block h-full w-full rounded-[2px] border",
                  kf.id === selectedId
                    ? "border-white bg-accent"
                    : "border-accent bg-accent/60 hover:bg-accent",
                )}
              />
            </button>
          );
        })}

        <div
          className="pointer-events-none absolute bottom-0 top-0 w-px bg-accent"
          style={{ left: pct(detailPct(currentTime)) }}
        >
          <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rounded-b-sm bg-accent" />
        </div>
      </div>

      {/* ── Overview ───────────────────────────────────────────────────── */}
      <div
        ref={overviewRef}
        className="relative h-7 w-full overflow-hidden rounded-small bg-surface touch-none"
        onPointerDown={handleOverviewDown}
        onPointerMove={handleOverviewMove}
        onPointerUp={endOverview}
        onPointerCancel={endOverview}
        title={
          zoomed
            ? "Drag the lit window to pan · click elsewhere to jump"
            : "Click or drag to jump · scroll on the track above to zoom in"
        }
      >
        {doc.keyframes.map((kf) => (
          <div
            key={kf.id}
            className={cn(
              "absolute bottom-1 top-1 w-px",
              kf.id === selectedId ? "bg-white" : "bg-accent/60",
            )}
            style={{ left: pct(overviewPct(kf.t)) }}
          />
        ))}

        {/* The slice of the clip the detail track is showing. */}
        <div
          className={cn(
            "absolute inset-y-0 border-x-2 border-accent/70 bg-accent/15",
            zoomed ? "cursor-grab" : "cursor-pointer",
          )}
          style={{ left: pct(overviewPct(view.start)), width: pct(view.span / duration) }}
        />

        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-accent"
          style={{ left: pct(overviewPct(currentTime)) }}
        />
      </div>
    </div>
  );
}

function TimelineButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-small border border-divider bg-background p-1 text-text-secondary transition hover:text-text-primary disabled:opacity-30"
    >
      {children}
    </button>
  );
}
