"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Pause,
  Play,
  Redo2,
  Save,
  Undo2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ReframeStage } from "./reframe-stage";
import { ReframePreview } from "./reframe-preview";
import { ReframeTimeline } from "./reframe-timeline";
import { ReframeInspector } from "./reframe-inspector";
import { ReframeExportDialog } from "./reframe-export-dialog";
import { ReframeSegmentsPanel } from "./reframe-segments-panel";
import { ReframeDebugPanel } from "./reframe-debug-panel";
import { checkExportSupport, type ExportQuality } from "@/lib/reframe/export";
import {
  NO_MARK,
  clearSegments,
  createDoc,
  keyframeEpsilon,
  cancelMark,
  forceMarkIn,
  keyframeNear,
  markIn,
  markOut,
  newKeyframeId,
  nextPlayTime,
  normaliseSegments,
  parseDoc,
  removeKeyframe,
  removeSegment,
  serializeDoc,
  updateKeyframe,
  updateSegment,
  upsertKeyframe,
  type Easing,
  type MarkResult,
  type MarkState,
  type ReframeDoc,
} from "@/lib/reframe/model";
import { clampCenter, solveState } from "@/lib/reframe/solve";
import { probeVideo } from "@/lib/reframe/probe";

const DEFAULT_FPS = 30;

/**
 * Number-key speed presets. The slow end is the point of this control: at 1× a
 * ball crosses the frame far too fast to tap accurately, so you drop to 0.5×
 * and click along with the action in something close to real time.
 *
 * -1 is reverse. Browsers reject a negative `playbackRate`, so it is simulated
 * by stepping `currentTime` backwards in the playback loop below.
 */
const PRESET_RATES = [-1, 0.5, 1, 1.5, 2] as const;

/**
 * The forward presets, which is what S/D step through. Stepping deliberately
 * uses the same ladder as the number keys: a separate finer ladder meant S/D
 * could land on a rate no button showed, so the row highlighted nothing.
 */
const FORWARD_RATES: number[] = PRESET_RATES.filter((rate) => rate > 0);

/** How many steps of undo to keep. */
const HISTORY_LIMIT = 100;

/**
 * One undo step. The marker draft rides along with the document because
 * setting an in-point is a visible edit the user expects to undo, even though
 * it deliberately leaves the document untouched.
 */
interface Snapshot {
  doc: ReframeDoc;
  mark: MarkState;
}

export function ReframeEditor() {
  const [file, setFile] = React.useState<File | null>(null);
  const [src, setSrc] = React.useState<string | null>(null);
  const [doc, setDoc] = React.useState<ReframeDoc | null>(null);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [playbackRate, setPlaybackRate] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = React.useState<string | null>(null);
  const [mark, setMark] = React.useState<MarkState>(NO_MARK);
  const [segmentsOnly, setSegmentsOnly] = React.useState(false);
  const [past, setPast] = React.useState<Snapshot[]>([]);
  const [future, setFuture] = React.useState<Snapshot[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Export settings live here so the sidebar can edit them and the header
  // button can act on them.
  const [quality, setQuality] = React.useState<ExportQuality>("high");
  const [includeAudio, setIncludeAudio] = React.useState(true);
  const [exportOpen, setExportOpen] = React.useState(false);
  // Bumped on every Export press; used as the dialog's key so each run is a
  // fresh component instance.
  const [exportRun, setExportRun] = React.useState(0);
  const [support, setSupport] = React.useState<{ ok: boolean; reason?: string } | null>(null);
  // ?debug=1 shows the GPU colour self-test panel. Read lazily so the page
  // stays static-export friendly (no useSearchParams / Suspense dance).
  const [debug] = React.useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug"),
  );

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const srcRef = React.useRef<string | null>(null);
  // Edits arrive faster than React re-renders (pointermove during a drag), so
  // handlers read and write the document through this ref and mirror it into
  // state for rendering.
  const docRef = React.useRef<ReframeDoc | null>(null);
  const dragKeyframeIdRef = React.useRef<string | null>(null);
  const markRef = React.useRef<MarkState>(NO_MARK);
  const segmentsOnlyRef = React.useRef(false);
  const pendingJumpRef = React.useRef<number | null>(null);
  const resizingSegmentRef = React.useRef(false);

  /**
   * Apply a new document, optionally without recording an undo step.
   *
   * `transient` is threaded through rather than inferred because commit() is
   * called both from discrete handlers and from pointermove during a drag —
   * and pushing history on every move of a reframe drag would bury the stack
   * under fifty entries for one gesture. Callers push once, at gesture start.
   */
  const commit = React.useCallback(
    (next: ReframeDoc, opts?: { transient?: boolean; mark?: MarkState }) => {
      const prev = docRef.current;
      // Captured before anything is mutated: the state updater below may run
      // later, by which point the refs would already hold the new values.
      const prevMark = markRef.current;

      if (prev && !opts?.transient) {
        setPast((p) => [...p, { doc: prev, mark: prevMark }].slice(-HISTORY_LIMIT));
        setFuture([]);
      }
      if (opts?.mark !== undefined) {
        markRef.current = opts.mark;
        setMark(opts.mark);
      }
      docRef.current = next;
      setDoc(next);
    },
    [],
  );

  const restore = React.useCallback((snapshot: Snapshot) => {
    docRef.current = snapshot.doc;
    setDoc(snapshot.doc);
    markRef.current = snapshot.mark;
    setMark(snapshot.mark);
  }, []);

  const undo = React.useCallback(() => {
    const prev = past[past.length - 1];
    const current = docRef.current;
    if (!prev || !current) return;
    setPast(past.slice(0, -1));
    setFuture([{ doc: current, mark: markRef.current }, ...future].slice(0, HISTORY_LIMIT));
    restore(prev);
  }, [future, past, restore]);

  const redo = React.useCallback(() => {
    const next = future[0];
    const current = docRef.current;
    if (!next || !current) return;
    setFuture(future.slice(1));
    setPast([...past, { doc: current, mark: markRef.current }].slice(-HISTORY_LIMIT));
    restore(next);
  }, [future, past, restore]);

  React.useEffect(() => {
    return () => {
      if (srcRef.current) URL.revokeObjectURL(srcRef.current);
    };
  }, []);

  // Probed once: WebCodecs and an H.264 encoder have to exist before it is
  // worth letting anyone start a five-minute render.
  React.useEffect(() => {
    let alive = true;
    checkExportSupport().then((s) => alive && setSupport(s));
    return () => {
      alive = false;
    };
  }, []);

  /* ── Loading ─────────────────────────────────────────────────────────── */

  const loadFile = React.useCallback(
    async (picked: File) => {
      setLoading(true);
      setError(null);
      try {
        const source = await probeVideo(picked);
        if (srcRef.current) URL.revokeObjectURL(srcRef.current);
        const url = URL.createObjectURL(picked);
        srcRef.current = url;

        setFile(picked);
        setSrc(url);
        commit(createDoc(source));
        setCurrentTime(0);
        setSelectedId(null);
        setSelectedSegmentId(null);
        setPlaying(false);
        markRef.current = NO_MARK;
        setMark(NO_MARK);
        setPast([]);
        setFuture([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [commit],
  );

  /* ── Transport ───────────────────────────────────────────────────────── */

  const seek = React.useCallback((t: number) => {
    const video = videoRef.current;
    const duration = docRef.current?.source.duration ?? 0;
    const clamped = Math.min(duration, Math.max(0, t));
    if (video) video.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  const togglePlay = React.useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      setPlaying(false);
      return;
    }
    // In reverse the element stays paused and the rAF loop drives currentTime.
    if (playbackRate > 0) void video.play();
    setPlaying(true);
  }, [playbackRate, playing]);

  const step = React.useCallback(
    (frames: number) => {
      const fps = docRef.current?.source.frameRate || DEFAULT_FPS;
      const video = videoRef.current;
      video?.pause();
      setPlaying(false);
      seek((video?.currentTime ?? 0) + frames / fps);
    },
    [seek],
  );

  /** Jump by whole seconds without stopping playback. */
  const nudgeSeconds = React.useCallback(
    (seconds: number) => {
      seek((videoRef.current?.currentTime ?? 0) + seconds);
    },
    [seek],
  );

  // Re-applied on `src` too: loading a new file resets the element's rate.
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playbackRate > 0) {
      video.playbackRate = playbackRate;
      if (playing && video.paused) void video.play();
    } else {
      // Reverse is driven by the loop below, so the element must stay paused.
      video.pause();
    }
  }, [playbackRate, playing, src]);

  const nudgeRate = React.useCallback((direction: -1 | 1) => {
    setPlaybackRate((prev) => {
      // Reverse is a deliberate choice (key 1), not somewhere you slide into
      // by stepping down. Stepping only ever leaves it.
      if (prev < 0) return direction > 0 ? FORWARD_RATES[0] : prev;
      let i = FORWARD_RATES.indexOf(prev);
      if (i === -1) {
        // Off-ladder: snap to the nearest step before moving.
        i = FORWARD_RATES.reduce(
          (best, rate, idx) =>
            Math.abs(rate - prev) < Math.abs(FORWARD_RATES[best] - prev) ? idx : best,
          0,
        );
      }
      return FORWARD_RATES[Math.min(FORWARD_RATES.length - 1, Math.max(0, i + direction))];
    });
  }, []);

  const toggleSegmentsOnly = React.useCallback(() => {
    const next = !segmentsOnly;
    segmentsOnlyRef.current = next;
    setSegmentsOnly(next);
  }, [segmentsOnly]);

  // Track playback position at display rate; `timeupdate` only fires ~4×/s,
  // which is far too coarse for the overlay to look attached to the video.
  // The same loop drives simulated reverse and the play-segments-only skip.
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - last) / 1000;
      last = now;
      const video = videoRef.current;
      if (!video) {
        raf = requestAnimationFrame(tick);
        return;
      }

      if (playbackRate < 0) {
        // Simulated reverse. Every backward frame decodes from the preceding
        // keyframe, which is why this stutters on long-GOP footage.
        const next = video.currentTime + elapsed * playbackRate; // rate is negative
        if (next <= 0) {
          video.currentTime = 0;
          setCurrentTime(0);
          setPlaying(false);
          return;
        }
        video.currentTime = next;
        setCurrentTime(next);
        raf = requestAnimationFrame(tick);
        return;
      }

      const t = video.currentTime;

      // `video.currentTime = x` is async. Without waiting for the seek to
      // land, the skip below re-issues the same jump every frame and playback
      // appears to hang at the first gap.
      const pending = pendingJumpRef.current;
      if (pending !== null) {
        if (t < pending - 0.05) {
          setCurrentTime(t);
          raf = requestAnimationFrame(tick);
          return;
        }
        pendingJumpRef.current = null;
      }

      // Only playback skips gaps — scrubbing and dragging while paused are
      // deliberately untouched, which is why this lives inside this effect.
      const current = docRef.current;
      if (segmentsOnlyRef.current && current && current.segments.length > 0) {
        const target = nextPlayTime(current, t);
        if (target === null) {
          video.pause();
          setPlaying(false);
          setCurrentTime(t);
          return;
        }
        if (target > t + 0.02) {
          pendingJumpRef.current = target;
          video.currentTime = target;
          setCurrentTime(target);
          raf = requestAnimationFrame(tick);
          return;
        }
      }

      setCurrentTime(t);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playbackRate, playing]);

  /* ── Editing ─────────────────────────────────────────────────────────── */

  const handlePick = React.useCallback((cx: number, cy: number) => {
    const current = docRef.current;
    if (!current) return;

    // A drag keeps editing the keyframe the gesture started on rather than
    // creating a new one per pointermove.
    const dragId = dragKeyframeIdRef.current;
    const dragKf = dragId ? current.keyframes.find((k) => k.id === dragId) : undefined;
    if (dragKf) {
      const centre = clampCenter(current, cx, cy, dragKf.zoom);
      // Mid-gesture: history was already pushed when the drag started.
      commit(updateKeyframe(current, dragKf.id, centre), { transient: true });
      return;
    }

    const t = videoRef.current?.currentTime ?? currentTime;
    const epsilon = keyframeEpsilon(current);
    const zoom = solveState(current, t).zoom;
    const centre = clampCenter(current, cx, cy, zoom);
    const id = keyframeNear(current, t, epsilon)?.id ?? newKeyframeId();

    dragKeyframeIdRef.current = id;
    commit(upsertKeyframe(current, { id, t, ...centre, zoom }, epsilon));
    setSelectedId(id);
    setSelectedSegmentId(null);
    setCurrentTime(t);
  }, [commit, currentTime]);

  const endPick = React.useCallback(() => {
    dragKeyframeIdRef.current = null;
  }, []);

  /** Places a keyframe at the playhead holding whatever the crop is there. */
  const addAtPlayhead = React.useCallback(() => {
    const current = docRef.current;
    if (!current) return;
    const t = videoRef.current?.currentTime ?? currentTime;
    const state = solveState(current, t);
    const epsilon = keyframeEpsilon(current);
    const id = keyframeNear(current, t, epsilon)?.id ?? newKeyframeId();
    commit(upsertKeyframe(current, { id, t, ...state }, epsilon));
    setSelectedId(id);
  }, [commit, currentTime]);

  const setZoomAtPlayhead = React.useCallback(
    (zoom: number) => {
      const current = docRef.current;
      if (!current) return;
      const t = videoRef.current?.currentTime ?? currentTime;
      const state = solveState(current, t);
      const centre = clampCenter(current, state.cx, state.cy, zoom);
      const epsilon = keyframeEpsilon(current);
      const id = keyframeNear(current, t, epsilon)?.id ?? newKeyframeId();
      commit(upsertKeyframe(current, { id, t, ...centre, zoom }, epsilon));
      setSelectedId(id);
    },
    [commit, currentTime],
  );

  const moveKeyframe = React.useCallback(
    (id: string, t: number, first: boolean) => {
      const current = docRef.current;
      if (!current) return;
      // History is pushed once, on the first move of the gesture.
      commit(updateKeyframe(current, id, { t }), { transient: !first });
      seek(t);
    },
    [commit, seek],
  );

  const setEasing = React.useCallback(
    (id: string, easing: Easing) => {
      const current = docRef.current;
      if (current) commit(updateKeyframe(current, id, { easing }));
    },
    [commit],
  );

  const deleteKeyframe = React.useCallback(
    (id: string) => {
      const current = docRef.current;
      if (!current) return;
      commit(removeKeyframe(current, id));
      setSelectedId((prev) => (prev === id ? null : prev));
    },
    [commit],
  );

  const setTarget = React.useCallback(
    (target: { width: number; height: number }) => {
      const current = docRef.current;
      if (current) commit({ ...current, target });
    },
    [commit],
  );

  /* ── Segments ────────────────────────────────────────────────────────── */

  const applyMark = React.useCallback(
    (fn: (doc: ReframeDoc, mark: MarkState, t: number) => MarkResult) => {
      const current = docRef.current;
      if (!current) return;
      const t = videoRef.current?.currentTime ?? currentTime;
      const result = fn(current, markRef.current, t);

      // Always goes through commit, even when the document is unchanged:
      // marking an in-point only moves the draft, but that is a visible edit
      // and must be undoable, so the mark is snapshotted with the document.
      commit(result.doc, { mark: result.mark });
      if (result.segmentId) {
        setSelectedSegmentId(result.segmentId);
        setSelectedId(null);
      }
    },
    [commit, currentTime],
  );

  /**
   * Live edge drag. Clamps only — merging here would dissolve the segment
   * under the pointer mid-gesture and leave the drag targeting a dead id.
   */
  const resizeSegment = React.useCallback(
    (id: string, edge: "start" | "end", t: number) => {
      const current = docRef.current;
      if (!current) return;
      const transient = resizingSegmentRef.current;
      resizingSegmentRef.current = true;
      commit(updateSegment(current, id, edge === "start" ? { start: t } : { end: t }), {
        transient,
      });
    },
    [commit],
  );

  /** Pointer-up: fold overlaps and renumber, as one step with the drag. */
  const commitSegments = React.useCallback(() => {
    resizingSegmentRef.current = false;
    const current = docRef.current;
    if (current) commit(normaliseSegments(current), { transient: true });
  }, [commit]);

  const deleteSegment = React.useCallback(
    (id: string) => {
      const current = docRef.current;
      if (!current) return;
      commit(removeSegment(current, id));
      setSelectedSegmentId((prev) => (prev === id ? null : prev));
    },
    [commit],
  );

  const renameSegment = React.useCallback(
    (id: string, name: string) => {
      const current = docRef.current;
      if (current) commit(updateSegment(current, id, { name }));
    },
    [commit],
  );

  const clearAllSegments = React.useCallback(() => {
    const current = docRef.current;
    if (!current) return;
    commit(clearSegments(current), { mark: NO_MARK });
    setSelectedSegmentId(null);
  }, [commit]);

  const selectSegment = React.useCallback((id: string | null) => {
    setSelectedSegmentId(id);
    if (id) setSelectedId(null);
  }, []);

  /* ── Keyboard ────────────────────────────────────────────────────────── */

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (!docRef.current) return;
      // These listen on window, so they would still fire under the export
      // overlay — Space would start playback behind it, A/F would edit the
      // document the render is reading.
      if (exportOpen) return;

      // Cmd/Ctrl+Z is the one shortcut that wants a modifier; everything else
      // is bare, so the letters below must not fire under one.
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod || e.altKey) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;

        // Speed presets on the number row.
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
          e.preventDefault();
          setPlaybackRate(PRESET_RATES[Number(e.key) - 1]);
          break;

        // Marking sits at the outer ends of the home row, with the speed keys
        // between them: a slip now lands on a harmless, obvious speed change
        // rather than on the opposite marker.
        case "a":
        case "A":
          e.preventDefault();
          // Shift forces the move, escaping markIn's forgiveness — without it
          // an in-point could never be set far ahead of an open draft.
          applyMark(e.shiftKey ? forceMarkIn : markIn);
          break;
        case "s":
        case "S":
          e.preventDefault();
          nudgeRate(-1);
          break;
        case "d":
        case "D":
          e.preventDefault();
          nudgeRate(1);
          break;
        case "f":
        case "F":
          e.preventDefault();
          applyMark(markOut);
          break;
        case "Escape":
          e.preventDefault();
          applyMark(cancelMark);
          break;
        case "g":
        case "G":
        // K was the original binding; kept as a silent alias.
        case "k":
        case "K":
          e.preventDefault();
          addAtPlayhead();
          break;
        case "t":
        case "T":
          e.preventDefault();
          toggleSegmentsOnly();
          break;

        // Scrubbing, on the row above the markers. Z/X/C/V stay as silent
        // aliases so anything already in the fingers keeps working.
        case "q":
        case "Q":
        case "z":
        case "Z":
          e.preventDefault();
          step(-1);
          break;
        case "w":
        case "W":
        case "x":
        case "X":
          e.preventDefault();
          step(1);
          break;
        case "e":
        case "E":
        case "c":
        case "C":
          e.preventDefault();
          nudgeSeconds(-1);
          break;
        case "r":
        case "R":
        case "v":
        case "V":
          e.preventDefault();
          nudgeSeconds(1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          step(e.shiftKey ? -10 : -1);
          break;
        case "ArrowRight":
          e.preventDefault();
          step(e.shiftKey ? 10 : 1);
          break;
        case "Home":
          e.preventDefault();
          seek(0);
          break;
        case "End":
          e.preventDefault();
          seek(docRef.current.source.duration);
          break;

        case "Delete":
        case "Backspace":
          if (selectedId) {
            e.preventDefault();
            deleteKeyframe(selectedId);
          } else if (selectedSegmentId) {
            e.preventDefault();
            deleteSegment(selectedSegmentId);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    addAtPlayhead,
    applyMark,
    deleteKeyframe,
    deleteSegment,
    exportOpen,
    nudgeRate,
    nudgeSeconds,
    redo,
    seek,
    selectedId,
    selectedSegmentId,
    step,
    toggleSegmentsOnly,
    togglePlay,
    undo,
  ]);

  /* ── Document save / load ────────────────────────────────────────────── */

  const saveDoc = () => {
    if (!doc) return;
    const blob = new Blob([serializeDoc(doc)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.source.name.replace(/\.[^.]+$/, "")}.reframe.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadDoc = async (jsonFile: File) => {
    const current = docRef.current;
    if (!current) return;
    try {
      const loaded = parseDoc(await jsonFile.text());
      // Keyframe positions are normalised, so a document saved against a
      // different encode of the same shot still applies. Keep the *loaded*
      // video's real metadata and take only the framing from the file.
      //
      // Segment bounds are in seconds, though, so they are clamped to this
      // video's duration and re-merged — a document from a longer source would
      // otherwise carry segments that sit past the end and never render.
      const segments = loaded.segments
        .map((seg) => ({
          ...seg,
          start: Math.min(seg.start, current.source.duration),
          end: Math.min(seg.end, current.source.duration),
        }))
        .filter((seg) => seg.end - seg.start > 0);
      commit(
        normaliseSegments({
          ...current,
          target: loaded.target,
          keyframes: loaded.keyframes,
          segments,
        }),
      );
      setSelectedId(null);
      setError(
        Math.abs(
          loaded.source.width / loaded.source.height - current.source.width / current.source.height,
        ) > 0.01
          ? "Loaded keyframes came from a video with a different aspect ratio — check the framing."
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /* ── Render ──────────────────────────────────────────────────────────── */

  if (!doc || !src || !file) {
    return (
      <FilePicker onPick={loadFile} loading={loading} error={error} />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{doc.source.name}</h1>
          <p className="text-xs text-text-secondary">
            {doc.source.width}×{doc.source.height}
            {doc.source.frameRate ? ` · ${doc.source.frameRate.toFixed(2)} fps` : ""} → {" "}
            {doc.target.width}×{doc.target.height}
            {doc.source.colorSpace ? ` · ${doc.source.colorSpace}` : ""}
            {doc.source.hdr ? " · HDR" : ""}
          </p>
          {doc.source.hdr && (
            <p className="mt-1 text-xs text-text-secondary">
              HDR source. The export tone-maps it to SDR automatically; if this browser
              can&rsquo;t, it falls back to the flatter built-in conversion and says so.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="cursor-pointer">
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadDoc(f);
                e.target.value = "";
              }}
            />
            <span className="inline-flex items-center gap-2 rounded-button border border-divider bg-surface px-3 py-1.5 text-sm hover:bg-surface-high">
              <Upload className="h-4 w-4" /> Load
            </span>
          </label>
          <Button variant="secondary" size="sm" onClick={saveDoc}>
            <Save className="h-4 w-4" /> Save
          </Button>
          <label className="cursor-pointer">
            <input
              type="file"
              accept="video/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
                e.target.value = "";
              }}
            />
            <span className="inline-flex items-center gap-2 rounded-button border border-divider bg-surface px-3 py-1.5 text-sm hover:bg-surface-high">
              <FolderOpen className="h-4 w-4" /> Video
            </span>
          </label>

          {/* The primary action, set apart from the document/file controls. */}
          <div className="ml-1 h-6 w-px bg-divider" aria-hidden />
          {/* Deliberately never disabled: the dialog is where someone looks
              when they want to export, so it is also where "you need a
              keyframe first" belongs — a dead button explains nothing. */}
          <Button
            size="sm"
            onClick={() => {
              setExportRun((n) => n + 1);
              setExportOpen(true);
            }}
            title={`Export ${doc.target.width}×${doc.target.height}${
              doc.segments.length > 1 ? ` · ${doc.segments.length} segments` : ""
            }`}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </header>

      {error && (
        <p className="rounded-small bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <ReframeStage
            doc={doc}
            src={src}
            videoRef={videoRef}
            currentTime={currentTime}
            onPick={handlePick}
            onPickEnd={endPick}
            onEnded={() => setPlaying(false)}
            onLoadedMetadata={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
          />

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => step(-1)} aria-label="Previous frame">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => step(1)} aria-label="Next frame">
              <ChevronRight className="h-4 w-4" />
            </Button>

            <div
              className="ml-1 flex items-center overflow-hidden rounded-button border border-divider"
              role="group"
              aria-label="Playback speed"
            >
              {PRESET_RATES.map((rate, i) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setPlaybackRate(rate)}
                  aria-pressed={playbackRate === rate}
                  title={`${rate < 0 ? "Reverse" : `${rate}× speed`} (${i + 1})`}
                  className={
                    playbackRate === rate
                      ? "bg-accent px-2.5 py-1.5 text-xs font-semibold text-background"
                      : "bg-surface px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                  }
                >
                  {rate < 0 ? "◀ rev" : `${rate}×`}
                </button>
              ))}
            </div>

            <div className="ml-1 flex items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={undo}
                disabled={past.length === 0}
                aria-label="Undo"
                title="Undo (⌘Z)"
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={redo}
                disabled={future.length === 0}
                aria-label="Redo"
                title="Redo (⇧⌘Z)"
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <p className="text-xs text-text-secondary">
            Click the video to place the frame ·{" "}
            <kbd className="rounded bg-surface px-1">A</kbd>
            <kbd className="ml-0.5 rounded bg-surface px-1">F</kbd> mark in/out ·{" "}
            <kbd className="rounded bg-surface px-1">S</kbd>
            <kbd className="ml-0.5 rounded bg-surface px-1">D</kbd> speed ·{" "}
            <kbd className="rounded bg-surface px-1">1</kbd>–
            <kbd className="rounded bg-surface px-1">5</kbd> preset ·{" "}
            <kbd className="rounded bg-surface px-1">Q</kbd>
            <kbd className="ml-0.5 rounded bg-surface px-1">W</kbd> frame ·{" "}
            <kbd className="rounded bg-surface px-1">E</kbd>
            <kbd className="ml-0.5 rounded bg-surface px-1">R</kbd> ±1s ·{" "}
            <kbd className="rounded bg-surface px-1">G</kbd> keyframe ·{" "}
            <kbd className="rounded bg-surface px-1">T</kbd> segments only
          </p>

          <ReframeTimeline
            doc={doc}
            currentTime={currentTime}
            selectedId={selectedId}
            selectedSegmentId={selectedSegmentId}
            openIn={mark.openIn}
            reelView={segmentsOnly}
            onSeek={seek}
            onSelect={(id) => {
              setSelectedId(id);
              if (id) setSelectedSegmentId(null);
            }}
            onMoveKeyframe={moveKeyframe}
            onSelectSegment={selectSegment}
            onResizeSegment={resizeSegment}
            onCommitSegments={commitSegments}
          />
        </div>

        <aside className="space-y-4">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Output preview
            </div>
            <ReframePreview
              doc={doc}
              videoRef={videoRef}
              currentTime={currentTime}
              playing={playing}
              className="mx-auto w-full max-w-[220px] rounded-card bg-black"
            />
            {doc.source.hdr && (
              <p className="mt-1.5 text-center text-[11px] leading-snug text-text-secondary">
                HDR source: this preview is the browser&rsquo;s own flat conversion. The
                exported file is tone-mapped and looks richer.
              </p>
            )}
          </div>

          <ReframeInspector
            doc={doc}
            currentTime={currentTime}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onSeek={seek}
            onRemove={deleteKeyframe}
            onSetEasing={setEasing}
            onSetZoom={setZoomAtPlayhead}
            onAddAtPlayhead={addAtPlayhead}
          />

          <ReframeSegmentsPanel
            doc={doc}
            selectedSegmentId={selectedSegmentId}
            segmentsOnly={segmentsOnly}
            openIn={mark.openIn}
            onToggleSegmentsOnly={toggleSegmentsOnly}
            onSelect={selectSegment}
            onSeek={seek}
            onRename={renameSegment}
            onDelete={deleteSegment}
            onClearAll={clearAllSegments}
          />

          {debug && <ReframeDebugPanel file={file} />}
        </aside>
      </div>

      {/* Keyed by run so each Export press mounts a clean dialog: no progress,
          result or error can survive from the previous export. */}
      {exportRun > 0 && (
        <ReframeExportDialog
          key={exportRun}
          doc={doc}
          file={file}
          quality={quality}
          includeAudio={includeAudio}
          unsupportedReason={support?.ok === false ? support.reason : undefined}
          open={exportOpen}
          onOpenChange={setExportOpen}
          onSetTarget={setTarget}
          onSetQuality={setQuality}
          onSetIncludeAudio={setIncludeAudio}
        />
      )}
    </div>
  );
}

function FilePicker({
  onPick,
  loading,
  error,
}: {
  onPick: (file: File) => void;
  loading: boolean;
  error: string | null;
}) {
  const [dragOver, setDragOver] = React.useState(false);

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">Reframe</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Turn a landscape clip into a vertical one. Scrub to a moment, tap where the action
        is, and the 9:16 frame moves there — repeat, and it animates between your taps.
      </p>

      <label
        className={`mt-6 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed p-12 text-center transition ${
          dragOver ? "border-accent bg-accent-muted" : "border-divider bg-surface"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onPick(f);
        }}
      >
        <input
          type="file"
          accept="video/*"
          className="sr-only"
          disabled={loading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = "";
          }}
        />
        {loading ? (
          <>
            <Spinner className="h-6 w-6 text-accent" />
            <span className="text-sm text-text-secondary">Reading video…</span>
          </>
        ) : (
          <>
            <FolderOpen className="h-8 w-8 text-accent" />
            <span className="text-sm font-medium">Choose a video, or drop one here</span>
            <span className="text-xs text-text-secondary">
              Stays on your device — nothing is uploaded.
            </span>
          </>
        )}
      </label>

      {error && (
        <p className="mt-4 rounded-small bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
