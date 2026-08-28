"use client";

import * as React from "react";
import { FlagTriangleRight, Minus, Plus, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoDropZone } from "@/components/video/video-drop-zone";
import { cn } from "@/lib/utils";
import { formatTimecode } from "@/lib/reframe/format";
import {
  DEFAULT_VIEW,
  FULL_FIT,
  clampView,
  MAX_ZOOM,
  clipDuration,
  clipFps,
  frameDuration,
  paneFit,
  panBy,
  viewTransform,
  zoomAt,
  type ClipSide,
  type CompareClip,
  type PaneView,
} from "@/lib/compare/model";
import { CompareScrub, type Grab } from "./compare-scrub";

interface Props {
  side: ClipSide;
  clip: CompareClip | null;
  src: string | null;
  videoRef: React.Ref<HTMLVideoElement>;
  /** This clip's own position, in its own seconds. */
  time: number;
  /** Height cap for the video box — see {@link ComparePane} for why width. */
  maxHeight: string;
  /**
   * Aspect of the viewport, independent of the footage. `null` matches the
   * source; a number (16/9) gives a wide window to pan a zoomed clip around in.
   */
  boxAspect: number | null;
  focused: boolean;
  isReference: boolean;
  /** False when this clip has been scrubbed away from the master position. */
  synced: boolean;
  loading: boolean;
  // Callbacks take the side rather than being bound to it by the parent: a
  // closure built per render would be re-created on every playhead tick, and
  // the React Compiler will not let render scope reach into refs anyway.
  onFocus: (side: ClipSide) => void;
  onPick: (side: ClipSide, file: File) => void;
  onScrub: (side: ClipSide, t: number) => void;
  onMoveStart: (side: ClipSide, t: number) => void;
  onMoveEnd: (side: ClipSide, t: number) => void;
  onGestureStart: (kind: Grab) => void;
  onGestureEnd: (kind: Grab) => void;
  onSetStart: (side: ClipSide) => void;
  onSetEnd: (side: ClipSide) => void;
  onResetMarks: (side: ClipSide) => void;
  onNudge: (side: ClipSide, frames: number) => void;
  onClearOffset: (side: ClipSide) => void;
  onResync: () => void;
  onLoadedMetadata: (side: ClipSide) => void;
  onError: (side: ClipSide) => void;
  onReady: (side: ClipSide) => void;
  /** True once the source is gone and only a fresh pick can bring it back. */
  lost: boolean;
}

/**
 * One clip: the video, its own scrub track, its markers and its nudge.
 *
 * The video box caps its *width*, not its height. `aspect-ratio` derives height
 * from a definite width, so a bare `max-height` stretches the box instead of
 * shrinking it — the same trick `reframe-stage.tsx` uses, halved because two
 * panes have to fit on screen at once.
 */
/** One wheel notch. Exponential so zooming feels the same at every level. */
const WHEEL_GAIN = 0.0015;

export function ComparePane({
  side,
  clip,
  src,
  videoRef,
  time,
  maxHeight,
  boxAspect,
  focused,
  isReference,
  synced,
  loading,
  onFocus,
  onPick,
  onScrub,
  onMoveStart,
  onMoveEnd,
  onGestureStart,
  onGestureEnd,
  onSetStart,
  onSetEnd,
  onResetMarks,
  onNudge,
  onClearOffset,
  onResync,
  onLoadedMetadata,
  onError,
  onReady,
  lost,
}: Props) {
  const name = side.toUpperCase();

  // Zoom and pan are this pane's business alone: they are a way of looking, not
  // part of the comparison, so they are never undoable and never shared with
  // the other pane — the two clips are shot from different places and the
  // interesting corner is somewhere else in each.
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState<PaneView>(DEFAULT_VIEW);
  const panRef = React.useRef<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = React.useState(false);
  // The wheel listener is bound once, so it reads the current fit from a ref.
  const fitRef = React.useRef(FULL_FIT);

  // The viewport is not the shape of the footage. A 9:16 clip in a 9:16 box
  // gives a tall sliver to zoom around in; the same clip in a 16:9 box is
  // letterboxed at zoom 1 — which costs nothing, since the height cap fixes the
  // picture size either way — and shows far more of it once zoomed in.
  const sourceAspect = clip ? clip.source.width / clip.source.height : 16 / 9;
  const aspect = boxAspect ?? sourceAspect;
  const fit = React.useMemo(
    () => (boxAspect === null ? FULL_FIT : paneFit(sourceAspect, aspect)),
    [aspect, boxAspect, sourceAspect],
  );
  React.useEffect(() => {
    fitRef.current = fit;
  }, [fit]);

  // Clamped on the way out rather than on the way in: switching the viewport
  // changes how far you may pan, and re-clamping stored state from an effect
  // would be a second render for something a pure function already answers.
  const shown = clampView(view, fit);

  // Native and non-passive: React's onWheel is passive and cannot stop the page
  // from scrolling underneath the zoom.
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const bx = (e.clientX - rect.left) / rect.width;
      const by = (e.clientY - rect.top) / rect.height;
      setView((v) => zoomAt(v, bx, by, Math.exp(-e.deltaY * WHEEL_GAIN), fitRef.current));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const startPan = (e: React.PointerEvent) => {
    if (shown.zoom <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = { x: e.clientX, y: e.clientY };
    setPanning(true);
  };

  const movePan = (e: React.PointerEvent) => {
    const from = panRef.current;
    if (!from) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    panRef.current = { x: e.clientX, y: e.clientY };
    const dx = (e.clientX - from.x) / rect.width;
    const dy = (e.clientY - from.y) / rect.height;
    setView((v) => panBy(v, dx, dy, fitRef.current));
  };

  const endPan = (e: React.PointerEvent) => {
    if (!panRef.current) return;
    panRef.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  if (!clip || !src || lost) {
    // A clip with markers but no pixels is a restored session, or a source the
    // browser dropped: name the file that is wanted so it can be found again.
    const wanted = clip?.source.name;
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Clip {name}
        </p>
        <VideoDropZone
          onPick={(file) => onPick(side, file)}
          loading={loading}
          label={wanted ? `Open ${wanted} again` : `Choose clip ${name}, or drop one here`}
          hint={
            wanted
              ? "Your markers are still here — they are reapplied to the file you pick."
              : undefined
          }
          className="p-8"
        />
      </div>
    );
  }

  const fps = clipFps(clip);
  const frame = frameDuration(clip);
  const offsetFrames = Math.round(clip.offset / frame);


  return (
    <div className="space-y-2" onPointerDown={() => onFocus(side)}>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center rounded-small text-[11px] font-semibold",
            focused ? "bg-accent text-background" : "bg-surface text-text-secondary",
          )}
        >
          {name}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{clip.source.name}</span>
        {isReference && (
          <span className="rounded-pill bg-accent-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
            reference
          </span>
        )}
        {!synced && (
          <button
            type="button"
            onClick={onResync}
            title="This clip has been scrubbed away from the master position"
            className="rounded-pill bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning hover:bg-warning/25"
          >
            off sync
          </button>
        )}
      </div>

      <div
        ref={boxRef}
        className={cn(
          "relative mx-auto w-full overflow-hidden rounded-card bg-black touch-none select-none",
          focused && "ring-2 ring-accent",
          shown.zoom > 1 && (panning ? "cursor-grabbing" : "cursor-grab"),
        )}
        style={{
          aspectRatio: `${aspect}`,
          maxWidth: `calc(${maxHeight} * ${aspect})`,
        }}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onDoubleClick={() => setView(DEFAULT_VIEW)}
      >
        <video
          ref={videoRef}
          src={src}
          className="absolute inset-0 h-full w-full object-contain"
          playsInline
          preload="auto"
          muted
          // Transform only: the crop is composited on the GPU, so zooming costs
          // nothing per frame and never touches the decoder.
          style={{ transform: viewTransform(shown), transformOrigin: "50% 50%" }}
          onLoadedMetadata={() => onLoadedMetadata(side)}
          onCanPlay={() => onReady(side)}
          onError={() => onError(side)}
        />

        {shown.zoom > 1 && (
          <button
            type="button"
            onClick={() => setView(DEFAULT_VIEW)}
            title="Reset zoom (or double-click the video)"
            className="absolute right-2 top-2 rounded-pill bg-background/80 px-2 py-0.5 font-mono text-[11px] tabular-nums text-accent hover:bg-background"
          >
            {shown.zoom.toFixed(1)}×
          </button>
        )}
      </div>

      <CompareScrub
        duration={clip.source.duration}
        time={time}
        start={clip.start}
        end={clip.end}
        offset={clip.offset}
        onScrub={(t) => onScrub(side, t)}
        onMoveStart={(t) => onMoveStart(side, t)}
        onMoveEnd={(t) => onMoveEnd(side, t)}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onSetStart(side)} title="Mark start here (A)">
          <FlagTriangleRight className="h-4 w-4" /> Start
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onSetEnd(side)} title="Mark end here (F)">
          <FlagTriangleRight className="h-4 w-4 -scale-x-100" /> End
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onResetMarks(side)}
          title="Back to the whole clip (Esc)"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-1">
          <Search className="h-3.5 w-3.5 text-text-secondary" />
          <button
            type="button"
            onClick={() => setView((v) => zoomAt(v, 0.5, 0.5, 1 / 1.4, fit))}
            disabled={shown.zoom <= 1}
            title="Zoom out (or scroll on the video)"
            className="rounded-small border border-divider bg-background p-1 text-text-secondary transition hover:text-text-primary disabled:opacity-30"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setView((v) => zoomAt(v, 0.5, 0.5, 1.4, fit))}
            disabled={shown.zoom >= MAX_ZOOM}
            title="Zoom in, then drag the video to pan"
            className="rounded-small border border-divider bg-background p-1 text-text-secondary transition hover:text-text-primary disabled:opacity-30"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <span className="text-[11px] uppercase tracking-wide text-text-secondary">nudge</span>
          <button
            type="button"
            onClick={() => onNudge(side, -1)}
            title="Shift this clip one frame earlier (C)"
            className="rounded-small border border-divider bg-background p-1 text-text-secondary transition hover:text-text-primary"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onClearOffset(side)}
            title="Clear the alignment nudge"
            className="min-w-10 rounded-small px-1 text-center font-mono text-xs tabular-nums text-accent hover:bg-surface-high"
          >
            {offsetFrames > 0 ? `+${offsetFrames}` : offsetFrames}f
          </button>
          <button
            type="button"
            onClick={() => onNudge(side, 1)}
            title="Shift this clip one frame later (V)"
            className="rounded-small border border-divider bg-background p-1 text-text-secondary transition hover:text-text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p className="text-xs text-text-secondary">
        <span className="font-mono text-accent">{formatTimecode(time, fps)}</span> ·{" "}
        {formatTimecode(clip.start, fps)}–{formatTimecode(clip.end, fps)} (
        {clipDuration(clip).toFixed(2)}s) · {clip.source.width}×{clip.source.height} ·{" "}
        {fps.toFixed(2)} fps
      </p>
    </div>
  );
}
