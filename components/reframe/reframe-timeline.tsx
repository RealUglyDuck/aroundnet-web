"use client";

import * as React from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  reelToSourceTime,
  sourceToReelTime,
  sourceToReelTimeClamped,
  totalSegmentDuration,
  type ReframeDoc,
  type ReframeKeyframe,
  type ReframeSegment,
} from "@/lib/reframe/model";
import { formatTimecode } from "@/lib/reframe/format";

interface Props {
  doc: ReframeDoc;
  currentTime: number;
  selectedId: string | null;
  selectedSegmentId: string | null;
  /** In-point of the segment being marked, drawn as a live dashed band. */
  openIn: number | null;
  /**
   * Show the reel rather than the source: gaps are collapsed so the timeline
   * matches what the export produces. Driven by "play segments only".
   */
  reelView: boolean;
  onSeek: (t: number) => void;
  onSelect: (id: string | null) => void;
  /** `first` marks the start of a drag gesture, so it can be one undo step. */
  onMoveKeyframe: (id: string, t: number, first: boolean) => void;
  onSelectSegment: (id: string | null) => void;
  /** Live during a drag: clamps only, no merging. */
  onResizeSegment: (id: string, edge: "start" | "end", t: number) => void;
  /** Pointer-up: merge and renumber once the gesture is over. */
  onCommitSegments: () => void;
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
  selectedSegmentId,
  openIn,
  reelView,
  onSeek,
  onSelect,
  onMoveKeyframe,
  onSelectSegment,
  onResizeSegment,
  onCommitSegments,
}: Props) {
  // Two coordinate spaces. Everything the component does internally — the view
  // window, ruler, band positions — is in *display* time; times crossing the
  // component boundary (currentTime, onSeek, keyframe and segment bounds) are
  // always *source* time. toDisplay/fromDisplay are the only bridge, so the
  // rest of the component is identical in both modes.
  const reel = reelView && doc.segments.length > 0;
  const duration = reel ? totalSegmentDuration(doc) : doc.source.duration;
  const toDisplay = React.useCallback(
    (t: number) => (reel ? sourceToReelTimeClamped(doc, t) : t),
    [doc, reel],
  );
  const fromDisplay = React.useCallback(
    (d: number) => (reel ? reelToSourceTime(doc, d) : d),
    [doc, reel],
  );

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

  // A new video — or a switch between source and reel view, which replaces the
  // coordinate space wholesale — resets the view to fit. Adjusting state during
  // render rather than in an effect avoids a frame showing the stale range.
  const timebaseKey = `${reel}:${duration}`;
  const [lastTimebase, setLastTimebase] = React.useState(timebaseKey);
  if (lastTimebase !== timebaseKey) {
    setLastTimebase(timebaseKey);
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

  /** Display time under the pointer on the detail track. */
  const displayAtDetail = React.useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      const { start, span } = viewRef.current;
      return clamp(start + ((clientX - rect.left) / rect.width) * span, 0, duration);
    },
    [duration],
  );

  /** Source time under the pointer — what callers outside this component want. */
  const timeAtDetail = React.useCallback(
    (clientX: number) => fromDisplay(displayAtDetail(clientX)),
    [displayAtDetail, fromDisplay],
  );

  const displayAtOverview = React.useCallback(
    (clientX: number) => {
      const rect = overviewRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
    },
    [duration],
  );

  /** Position of a *source* time within the detail track, 0–1. */
  const detailPct = (t: number) =>
    view.span > 0 ? (toDisplay(t) - view.start) / view.span : 0;
  /** Position of a *display* time, for spans already measured in display time. */
  const detailPctOfDisplay = (d: number) => (view.span > 0 ? (d - view.start) / view.span : 0);
  const overviewPct = (t: number) => (duration > 0 ? toDisplay(t) / duration : 0);
  const overviewPctOfDisplay = (d: number) => (duration > 0 ? d / duration : 0);

  /* ── Keep the playhead in view ───────────────────────────────────────── */

  React.useEffect(() => {
    const { start, span } = viewRef.current;
    if (span >= duration) return;
    const head = toDisplay(currentTime);
    if (head >= start && head <= start + span) return;
    // Park the playhead 10% in from the left so playback has room to run
    // before the next scroll, instead of re-scrolling every frame.
    setViewClamped(head - span * 0.1, span);
  }, [currentTime, duration, setViewClamped, toDisplay]);

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

  /**
   * Zoom held on the playhead, for the buttons — the wheel has the pointer to
   * aim with, but a button press has only the playhead, which is what you are
   * looking at anyway. It keeps its position on screen, so the frame you were
   * inspecting doesn't slide away as the ruler grows.
   *
   * If the playhead is off-screen (you panned away while paused) it is pulled
   * to the middle instead, since zooming toward an edge it isn't on would
   * just be a lurch to nowhere.
   */
  const zoomAtPlayhead = React.useCallback(
    (factor: number) => {
      const { start, span } = viewRef.current;
      const head = toDisplay(currentTime);
      const ratio = span > 0 ? (head - start) / span : 0.5;
      const anchor = ratio < 0 || ratio > 1 ? 0.5 : ratio;
      const nextSpan = clamp(span * factor, minView, duration);
      setViewClamped(head - anchor * nextSpan, nextSpan);
    },
    [currentTime, duration, minView, setViewClamped, toDisplay],
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
  const segmentDragRef = React.useRef<{ id: string; edge: "start" | "end" } | null>(null);
  const keyframeMovedRef = React.useRef(false);

  // pointermove fires far faster than the display refreshes — a high-polling-
  // rate mouse easily exceeds 500Hz — and each drag update re-renders the whole
  // editor and assigns video.currentTime, which forces a decode. Coalescing to
  // one update per animation frame is the difference between a smooth scrub and
  // a queue of seeks the browser can never catch up with.
  const frameRef = React.useRef<number | null>(null);
  const pendingRef = React.useRef<(() => void) | null>(null);

  const scheduleFrame = React.useCallback((fn: () => void) => {
    pendingRef.current = fn;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const run = pendingRef.current;
      pendingRef.current = null;
      run?.();
    });
  }, []);

  /** Apply the last queued update now — the final position must not be lost. */
  const flushFrame = React.useCallback(() => {
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

  const handleDetailDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    onSeek(timeAtDetail(e.clientX));
  };

  const handleDetailMove = (e: React.PointerEvent) => {
    // Read the coordinate now; the scheduled callback runs after the event.
    const { clientX } = e;
    const segmentDrag = segmentDragRef.current;
    if (segmentDrag) {
      scheduleFrame(() =>
        onResizeSegment(segmentDrag.id, segmentDrag.edge, timeAtDetail(clientX)),
      );
      return;
    }
    const draggingId = draggingRef.current;
    if (draggingId) {
      scheduleFrame(() => {
        onMoveKeyframe(draggingId, timeAtDetail(clientX), !keyframeMovedRef.current);
        keyframeMovedRef.current = true;
      });
      return;
    }
    if (scrubbing) scheduleFrame(() => onSeek(timeAtDetail(clientX)));
  };

  const endDetail = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // Land the final position before committing, so the merge sees where the
    // edge actually ended up rather than one frame behind.
    flushFrame();
    draggingRef.current = null;
    setScrubbing(false);
    if (segmentDragRef.current) {
      segmentDragRef.current = null;
      onCommitSegments();
    }
  };

  const startSegmentDrag = (
    e: React.PointerEvent,
    seg: ReframeSegment,
    edge: "start" | "end",
  ) => {
    e.stopPropagation();
    // Capture on the track, not the handle: the handle moves out from under
    // the pointer as it is dragged.
    trackRef.current?.setPointerCapture(e.pointerId);
    segmentDragRef.current = { id: seg.id, edge };
    onSelectSegment(seg.id);
  };

  const startKeyframeDrag = (e: React.PointerEvent, kf: ReframeKeyframe) => {
    e.stopPropagation();
    // Capture on the track, not the marker: the marker moves out from under
    // the pointer as it is dragged.
    trackRef.current?.setPointerCapture(e.pointerId);
    draggingRef.current = kf.id;
    keyframeMovedRef.current = false;
    onSelect(kf.id);
    onSeek(kf.t);
  };

  /* ── Overview pointer handling ───────────────────────────────────────── */

  const panRef = React.useRef<{ grabOffset: number } | null>(null);

  const handleOverviewDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = displayAtOverview(e.clientX);
    const { start, span } = viewRef.current;
    if (zoomed && d >= start && d <= start + span) {
      // Grabbing the window itself pans without moving the playhead.
      panRef.current = { grabOffset: d - start };
    } else {
      panRef.current = null;
      onSeek(fromDisplay(d));
    }
  };

  const handleOverviewMove = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const { clientX } = e;
    scheduleFrame(() => {
      const d = displayAtOverview(clientX);
      if (panRef.current) {
        setViewClamped(d - panRef.current.grabOffset, viewRef.current.span);
      } else {
        onSeek(fromDisplay(d));
      }
    });
  };

  const endOverview = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    flushFrame();
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
            {doc.segments.length > 0 && (
              <>
                {reel ? "reel · " : ""}
                {doc.segments.length} segment{doc.segments.length === 1 ? "" : "s"} ·{" "}
                {formatTimecode(totalSegmentDuration(doc))} ·{" "}
              </>
            )}
            {doc.keyframes.length} keyframe{doc.keyframes.length === 1 ? "" : "s"} ·{" "}
            {zoomed ? `${formatTimecode(view.span)} shown` : formatTimecode(duration)}
          </span>
          <TimelineButton onClick={() => zoomAtPlayhead(1 / 1.8)} label="Zoom in on playhead">
            <ZoomIn className="h-3.5 w-3.5" />
          </TimelineButton>
          <TimelineButton onClick={() => zoomAtPlayhead(1.8)} label="Zoom out from playhead">
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
        className="relative h-24 w-full cursor-pointer overflow-hidden rounded-card bg-surface touch-none"
        onPointerDown={handleDetailDown}
        onPointerMove={handleDetailMove}
        onPointerUp={endDetail}
        onPointerCancel={endDetail}
      >
        <div className="absolute inset-x-0 top-0 h-6 border-b border-divider">
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute top-0 h-full"
              style={{ left: pct(detailPctOfDisplay(t)) }}
            >
              <div className="h-2 w-px bg-divider" />
              <span className="absolute left-1 top-1 whitespace-nowrap text-[10px] tabular-nums text-text-secondary">
                {formatTimecode(t, interval < 1 ? doc.source.frameRate : undefined)}
              </span>
            </div>
          ))}
        </div>

        {/* Segment bands, between the ruler and the keyframe row. */}
        {doc.segments.map((seg) => {
          const left = detailPct(seg.start);
          // In reel view the bands butt together, so the right edge is measured
          // from the left plus the segment's own length rather than from
          // toDisplay(seg.end) — which would land on the *next* segment.
          const width = (seg.end - seg.start) / view.span;
          if (left + width < -0.02 || left > 1.02) return null;
          const isSelected = seg.id === selectedSegmentId;
          return (
            <div
              key={seg.id}
              className={cn(
                "absolute top-7 flex h-7 items-center overflow-hidden border",
                reel ? "rounded-none border-x-2" : "rounded-small",
                isSelected
                  ? "border-accent bg-accent/35"
                  : "border-accent/50 bg-accent/20 hover:bg-accent/30",
              )}
              style={{ left: pct(left), width: pct(width) }}
              // No stopPropagation: clicking a band selects it and still
              // scrubs, so dragging across the track keeps working.
              onPointerDown={() => onSelectSegment(seg.id)}
            >
              <span className="truncate px-1.5 text-[10px] text-text-primary">{seg.name}</span>
              {/* Edges can't be dragged in reel view: a segment's start sits at
                  a fixed reel position no matter where it points into the
                  source, so the handle could never follow the pointer. */}
              {!reel && (
                <>
                  <div
                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize touch-none"
                    onPointerDown={(e) => startSegmentDrag(e, seg, "start")}
                  />
                  <div
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none"
                    onPointerDown={(e) => startSegmentDrag(e, seg, "end")}
                  />
                </>
              )}
            </div>
          );
        })}

        {/* The segment currently being marked. Hidden in reel view, where a
            draft in a gap has no position to occupy. */}
        {openIn !== null && !reel && (
          <div
            className="pointer-events-none absolute top-7 h-7 rounded-small border border-dashed border-accent bg-accent/10"
            style={{
              left: pct(detailPct(Math.min(openIn, currentTime))),
              width: pct(Math.abs(currentTime - openIn) / view.span),
            }}
          />
        )}

        {/* The animated span, so it's obvious where the pan is defined. */}
        {first && last && last.t > first.t && (
          <div
            className="absolute top-[76px] h-0.5 rounded-pill bg-accent/40"
            style={{
              left: pct(detailPct(first.t)),
              width: pct((toDisplay(last.t) - toDisplay(first.t)) / view.span),
            }}
          />
        )}

        {doc.keyframes.map((kf) => {
          // In reel view a keyframe inside a gap is genuinely absent from the
          // output, so it is hidden rather than piled onto the nearest cut.
          if (reel && sourceToReelTime(doc, kf.t) === null) return null;
          const p = detailPct(kf.t);
          if (p < -0.02 || p > 1.02) return null;
          return (
            <button
              key={kf.id}
              type="button"
              aria-label={`Keyframe at ${formatTimecode(kf.t, doc.source.frameRate)}`}
              className="absolute top-[77px] -ml-[7px] h-3.5 w-3.5 rotate-45 rounded-[2px] transition-colors"
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
          reel
            ? "Showing the reel — gaps are collapsed. Turn off \u201cplay segments only\u201d to edit the source."
            : zoomed
              ? "Drag the lit window to pan · click elsewhere to jump"
              : "Click or drag to jump · scroll on the track above to zoom in"
        }
      >
        {doc.segments.map((seg) => (
          <div
            key={seg.id}
            className={cn(
              "absolute inset-y-0",
              reel && "border-r border-background",
              seg.id === selectedSegmentId ? "bg-accent/45" : "bg-accent/25",
            )}
            style={{
              left: pct(overviewPct(seg.start)),
              width: pct((seg.end - seg.start) / duration),
            }}
          />
        ))}

        {doc.keyframes.map((kf) => {
          if (reel && sourceToReelTime(doc, kf.t) === null) return null;
          return (
            <div
              key={kf.id}
              className={cn(
                "absolute bottom-1 top-1 w-px",
                kf.id === selectedId ? "bg-white" : "bg-accent/60",
              )}
              style={{ left: pct(overviewPct(kf.t)) }}
            />
          );
        })}

        {/* The slice of the clip the detail track is showing. */}
        <div
          className={cn(
            "absolute inset-y-0 border-x-2 border-accent/70 bg-accent/15",
            zoomed ? "cursor-grab" : "cursor-pointer",
          )}
          style={{
            left: pct(overviewPctOfDisplay(view.start)),
            width: pct(view.span / duration),
          }}
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
