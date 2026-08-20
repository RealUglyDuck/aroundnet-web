"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Pause,
  Play,
  Save,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ReframeStage } from "./reframe-stage";
import { ReframePreview } from "./reframe-preview";
import { ReframeTimeline } from "./reframe-timeline";
import { ReframeInspector } from "./reframe-inspector";
import { ReframeExportPanel } from "./reframe-export-panel";
import {
  createDoc,
  keyframeEpsilon,
  keyframeNear,
  newKeyframeId,
  parseDoc,
  removeKeyframe,
  serializeDoc,
  updateKeyframe,
  upsertKeyframe,
  type Easing,
  type ReframeDoc,
} from "@/lib/reframe/model";
import { clampCenter, solveState } from "@/lib/reframe/solve";
import { probeVideo } from "@/lib/reframe/probe";

const DEFAULT_FPS = 30;

/**
 * Playback rates. The slow end is the point of this control: at 1× a ball
 * crosses the frame far too fast to tap accurately, so you drop to 0.1–0.25×
 * and click along with the action in something close to real time.
 */
const PLAYBACK_RATES = [0.1, 0.25, 0.5, 1, 2] as const;

export function ReframeEditor() {
  const [file, setFile] = React.useState<File | null>(null);
  const [src, setSrc] = React.useState<string | null>(null);
  const [doc, setDoc] = React.useState<ReframeDoc | null>(null);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [playbackRate, setPlaybackRate] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const srcRef = React.useRef<string | null>(null);
  // Edits arrive faster than React re-renders (pointermove during a drag), so
  // handlers read and write the document through this ref and mirror it into
  // state for rendering.
  const docRef = React.useRef<ReframeDoc | null>(null);
  const dragKeyframeIdRef = React.useRef<string | null>(null);

  const commit = React.useCallback((next: ReframeDoc) => {
    docRef.current = next;
    setDoc(next);
  }, []);

  React.useEffect(() => {
    return () => {
      if (srcRef.current) URL.revokeObjectURL(srcRef.current);
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
        setPlaying(false);
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
    if (video.paused) {
      void video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }, []);

  const step = React.useCallback(
    (frames: number) => {
      const fps = docRef.current?.source.frameRate || DEFAULT_FPS;
      const video = videoRef.current;
      if (video && !video.paused) {
        video.pause();
        setPlaying(false);
      }
      seek((video?.currentTime ?? 0) + frames / fps);
    },
    [seek],
  );

  // Re-applied on `src` too: loading a new file resets the element's rate.
  React.useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [playbackRate, src]);

  const nudgeRate = React.useCallback((direction: -1 | 1) => {
    setPlaybackRate((prev) => {
      const i = PLAYBACK_RATES.indexOf(prev as (typeof PLAYBACK_RATES)[number]);
      const next = (i === -1 ? PLAYBACK_RATES.indexOf(1) : i) + direction;
      return PLAYBACK_RATES[Math.min(PLAYBACK_RATES.length - 1, Math.max(0, next))];
    });
  }, []);

  // Track playback position at display rate; `timeupdate` only fires ~4×/s,
  // which is far too coarse for the overlay to look attached to the video.
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) setCurrentTime(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

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
      docRef.current = updateKeyframe(current, dragKf.id, centre);
      setDoc(docRef.current);
      return;
    }

    const t = videoRef.current?.currentTime ?? currentTime;
    const epsilon = keyframeEpsilon(current);
    const zoom = solveState(current, t).zoom;
    const centre = clampCenter(current, cx, cy, zoom);
    const id = keyframeNear(current, t, epsilon)?.id ?? newKeyframeId();

    dragKeyframeIdRef.current = id;
    docRef.current = upsertKeyframe(current, { id, t, ...centre, zoom }, epsilon);
    setDoc(docRef.current);
    setSelectedId(id);
    setCurrentTime(t);
  }, [currentTime]);

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
    (id: string, t: number) => {
      const current = docRef.current;
      if (!current) return;
      commit(updateKeyframe(current, id, { t }));
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

  /* ── Keyboard ────────────────────────────────────────────────────────── */

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (!docRef.current) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          step(e.shiftKey ? -10 : -1);
          break;
        case "ArrowRight":
          e.preventDefault();
          step(e.shiftKey ? 10 : 1);
          break;
        case "k":
        case "K":
          e.preventDefault();
          addAtPlayhead();
          break;
        case "Delete":
        case "Backspace":
          if (selectedId) {
            e.preventDefault();
            deleteKeyframe(selectedId);
          }
          break;
        case "[":
          e.preventDefault();
          nudgeRate(-1);
          break;
        case "]":
          e.preventDefault();
          nudgeRate(1);
          break;
        case "Home":
          e.preventDefault();
          seek(0);
          break;
        case "End":
          e.preventDefault();
          seek(docRef.current.source.duration);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addAtPlayhead, deleteKeyframe, nudgeRate, seek, selectedId, step, togglePlay]);

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
      commit({ ...current, target: loaded.target, keyframes: loaded.keyframes });
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
          </p>
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
              {PLAYBACK_RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setPlaybackRate(rate)}
                  aria-pressed={playbackRate === rate}
                  className={
                    playbackRate === rate
                      ? "bg-accent px-2.5 py-1.5 text-xs font-semibold text-background"
                      : "bg-surface px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                  }
                >
                  {rate}×
                </button>
              ))}
            </div>

            <p className="ml-2 text-xs text-text-secondary">
              Tap or drag the video to place the frame · Space to play · ←/→ step ·{" "}
              <kbd className="rounded bg-surface px-1">[</kbd>
              <kbd className="rounded bg-surface px-1">]</kbd> speed · scroll the timeline
              to zoom
            </p>
          </div>

          <ReframeTimeline
            doc={doc}
            currentTime={currentTime}
            selectedId={selectedId}
            onSeek={seek}
            onSelect={setSelectedId}
            onMoveKeyframe={moveKeyframe}
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
              className="mx-auto w-full max-w-[220px] rounded-card bg-black"
            />
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

          <ReframeExportPanel doc={doc} file={file} onSetTarget={setTarget} />
        </aside>
      </div>
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
