"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Pause,
  Play,
  Redo2,
  Repeat,
  Rows2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SpeedControl } from "@/components/video/speed-control";
import { nudgeRate as stepRate } from "@/lib/video/rates";
import { cn } from "@/lib/utils";
import { probeVideo } from "@/lib/reframe/probe";
import { formatTimecode } from "@/lib/reframe/format";
import { clamp } from "@/lib/reframe/model";
import {
  EMPTY_DOC,
  SIDES,
  clearOffset,
  parseDoc,
  replaceSource,
  serializeDoc,
  frameDuration,
  clipFps,
  createClip,
  frameStepU,
  longerSide,
  masterDuration,
  nudgeOffset,
  otherSide,
  referenceClip,
  referenceSide,
  resetMarks,
  sampleTime,
  setClip,
  setEnd,
  setReference,
  setStart,
  timeToU,
  uToMaster,
  type ClipSide,
  type CompareDoc,
} from "@/lib/compare/model";
import { ComparePane } from "./compare-pane";
import { CompareTimeline } from "./compare-timeline";
import type { Grab } from "./compare-scrub";

/**
 * Slower than the reframe editor's ladder on purpose: this tool exists to look
 * at a tenth of a second of arm movement, and 0.25× is where that becomes
 * readable. -1 is reverse, simulated by stepping backwards in the loop below.
 */
const PRESET_RATES = [-1, 0.25, 0.5, 1, 2] as const;

const HISTORY_LIMIT = 100;

/**
 * Phase error past which a pane is reported "off sync" — but only once a pane
 * has actually been scrubbed on its own. Playback drift is not off sync: the
 * follower is *allowed* to wander up to HARD_SYNC before anything corrects it,
 * so deriving the badge from drift alone lights it up through every playback.
 */
const SYNC_TOLERANCE = 0.05;

/**
 * How often playback pushes the playhead into React, in ms. The seek loop still
 * runs every animation frame; only the re-render is throttled.
 */
const UI_INTERVAL = 1000 / 30;

/**
 * Largest step the clock will take in one tick, in seconds.
 *
 * `requestAnimationFrame` stops firing in a hidden tab and can stall for a long
 * time under GC or decode pressure. Without a cap the first tick after a stall
 * carries the whole gap and teleports the playhead to the end of the range.
 */
const MAX_TICK = 0.25;

/** Where the markers are kept so a reload or a discarded tab does not lose them. */
const STORAGE_KEY = "aroundnet.compare.doc";

/** Height cap for one pane. Two side by side get more room than two stacked. */
const PANE_HEIGHT = { side: "48vh", stacked: "32vh" } as const;

type Layout = keyof typeof PANE_HEIGHT;

/**
 * Viewport shape. "wide" gives every pane a 16:9 window regardless of the
 * footage — portrait clips are letterboxed at zoom 1, which costs nothing
 * because the height cap already decides how big the picture is, and gives you
 * far more to look at once zoomed. "fit" matches the source and shows no bars.
 */
const BOX_ASPECT = { wide: 16 / 9, fit: null } as const;

type Viewport = keyof typeof BOX_ASPECT;
type BySide<T> = Record<ClipSide, T>;

/**
 * Two clips, one normalised playhead.
 *
 * The single source of truth for what is on screen is `times` — each clip's own
 * position. The master `u` is *derived* from the reference clip's position, and
 * everything else (the master track, playback, frame stepping) is a way of
 * writing `times`. That is what lets a pane be scrubbed off on its own while
 * you hunt for the contact frame, without a second position to keep reconciled.
 */
export function CompareViewer() {
  const [doc, setDocState] = React.useState<CompareDoc>(EMPTY_DOC);
  const [srcs, setSrcs] = React.useState<BySide<string | null>>({ a: null, b: null });
  const [times, setTimes] = React.useState<BySide<number>>({ a: 0, b: 0 });
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<number>(1);
  const [loop, setLoopState] = React.useState(true);
  const [focus, setFocus] = React.useState<ClipSide>("a");
  const [layout, setLayout] = React.useState<Layout>("side");
  const [viewport, setViewport] = React.useState<Viewport>("wide");
  const [loading, setLoading] = React.useState<BySide<boolean>>({ a: false, b: false });
  const [error, setError] = React.useState<string | null>(null);
  // Set when a pane is scrubbed on its own, cleared whenever the master is
  // applied. Never set by playback — see SYNC_TOLERANCE.
  const [desynced, setDesynced] = React.useState(false);
  // A side whose source died and could not be re-opened without the file again.
  const [lost, setLost] = React.useState<BySide<boolean>>({ a: false, b: false });
  const [saved, setSaved] = React.useState<CompareDoc | null>(null);
  const [past, setPast] = React.useState<CompareDoc[]>([]);
  const [future, setFuture] = React.useState<CompareDoc[]>([]);

  const videoARef = React.useRef<HTMLVideoElement>(null);
  const videoBRef = React.useRef<HTMLVideoElement>(null);
  /**
   * Indexed lookup, so the sync loop can talk about "the reference" and "the
   * follower" without branching on which side each is. A `useCallback` rather
   * than a plain helper because render scope may not reach into refs.
   */
  const videoOf = React.useCallback(
    (side: ClipSide) => (side === "a" ? videoARef.current : videoBRef.current),
    [],
  );

  // Mirrors of state read inside rAF and pointer handlers, which run between
  // renders and would otherwise see stale values. Written only from callbacks.
  const docRef = React.useRef(EMPTY_DOC);
  const timesRef = React.useRef<BySide<number>>({ a: 0, b: 0 });
  const loopRef = React.useRef(true);
  const urlsRef = React.useRef<BySide<string | null>>({ a: null, b: null });
  // The picked File is kept, not just the URL made from it: a browser that has
  // dropped the blob can be handed a fresh one, and without the File there is
  // nothing to recover from.
  const filesRef = React.useRef<BySide<File | null>>({ a: null, b: null });
  const retriedRef = React.useRef<BySide<boolean>>({ a: false, b: false });
  const staleUrlsRef = React.useRef<string[]>([]);
  const lastUiRef = React.useRef(0);

  React.useEffect(
    () => () => {
      for (const url of Object.values(urlsRef.current)) {
        if (url) URL.revokeObjectURL(url);
      }
      for (const url of staleUrlsRef.current.splice(0)) URL.revokeObjectURL(url);
    },
    [],
  );

  /* ── History ─────────────────────────────────────────────────────────── */

  /** Write the document without touching history — for live drag updates. */
  const setDoc = React.useCallback((next: CompareDoc) => {
    docRef.current = next;
    setDocState(next);
  }, []);

  const pushHistory = React.useCallback(() => {
    setPast([...past, docRef.current].slice(-HISTORY_LIMIT));
    setFuture([]);
  }, [past]);

  const commit = React.useCallback(
    (next: CompareDoc) => {
      pushHistory();
      setDoc(next);
    },
    [pushHistory, setDoc],
  );

  const undo = React.useCallback(() => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([docRef.current, ...future].slice(0, HISTORY_LIMIT));
    setDoc(prev);
  }, [future, past, setDoc]);

  const redo = React.useCallback(() => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, docRef.current].slice(-HISTORY_LIMIT));
    setDoc(next);
  }, [future, past, setDoc]);

  /* ── Positions ───────────────────────────────────────────────────────── */

  const writeTimes = React.useCallback((next: BySide<number>) => {
    timesRef.current = next;
    setTimes(next);
  }, []);

  /** Master position, derived from wherever the reference clip is sitting. */
  const currentU = React.useCallback(() => {
    const d = docRef.current;
    const side = referenceSide(d);
    const clip = d[side];
    return clip ? timeToU(clip, timesRef.current[side]) : 0;
  }, []);

  /** Put every loaded clip at master position `u`. */
  const applyU = React.useCallback(
    (u: number) => {
      const d = docRef.current;
      const next = { ...timesRef.current };
      for (const side of SIDES) {
        const clip = d[side];
        if (!clip) continue;
        const t = sampleTime(clip, u);
        const video = videoOf(side);
        if (video) video.currentTime = t;
        next[side] = t;
      }
      writeTimes(next);
      setDesynced(false);
    },
    [videoOf, writeTimes],
  );

  /** Move one clip alone. This is how you hunt for a frame to mark. */
  const scrubClip = React.useCallback(
    (side: ClipSide, t: number) => {
      const clip = docRef.current[side];
      if (!clip) return;
      const clamped = clamp(t, 0, clip.source.duration);
      const video = videoOf(side);
      if (video) video.currentTime = clamped;
      writeTimes({ ...timesRef.current, [side]: clamped });
    },
    [videoOf, writeTimes],
  );

  /* ── Transport ───────────────────────────────────────────────────────── */

  const setLoop = React.useCallback((on: boolean) => {
    loopRef.current = on;
    setLoopState(on);
  }, []);

  const toggleLoop = React.useCallback(() => setLoop(!loopRef.current), [setLoop]);

  const togglePlay = React.useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!referenceClip(docRef.current)) return;
    // Playing means "play the comparison", so anything scrubbed away on its own
    // is pulled back onto the master first. Starting from an edge restarts.
    const u = currentU();
    const from = speed < 0 ? (u <= 1e-4 ? 1 : u) : u >= 1 - 1e-4 ? 0 : u;
    applyU(from);
    setPlaying(true);
  }, [applyU, currentU, playing, speed]);

  const stepFrames = React.useCallback(
    (frames: number) => {
      setPlaying(false);
      // Stepped in frames of the clip you are looking at — see `frameStepU`.
      applyU(clamp(currentU() + frames * frameStepU(docRef.current, focus), 0, 1));
    },
    [applyU, currentU, focus],
  );

  /** Jump the focused clip alone, for finding the moment before marking it. */
  const nudgeFocusSeconds = React.useCallback(
    (seconds: number) => {
      setPlaying(false);
      scrubClip(focus, timesRef.current[focus] + seconds);
    },
    [focus, scrubClip],
  );

  /**
   * Playback.
   *
   * One clock advances the master position and *seeks* both clips to it. The
   * elements are never played.
   *
   * The obvious design — play both at matched `playbackRate`s and correct the
   * drift — was tried first and does not work. Two media elements have
   * independent clocks and independent decoders, nothing synchronises them, and
   * every correction is either a seek you can see or a rate change that
   * re-primes the decoder. Worse, its failure mode is the pair *tearing apart*,
   * which is the one thing a comparison tool must never do. (The Swift app
   * reaches the same conclusion by omission: its comparison view has no play
   * button, only a scrubber that seeks both slots.)
   *
   * Seeking from one clock inverts that. Both clips are at exactly the same
   * phase by construction, so drift cannot exist; and because the clock stalls
   * while either clip is still fetching a frame, running out of decode budget
   * slows the pair down together instead of separating them. A comparison that
   * plays slightly slow is still a comparison.
   */
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let u = currentU();

    const tick = (now: number) => {
      const d = docRef.current;
      const span = masterDuration(d);
      if (span <= 0) {
        setPlaying(false);
        return;
      }

      // Back-pressure. While either clip is still fetching the frame we asked
      // for, the clock does not advance — this is what keeps the two locked
      // under load, and it is the whole reason this design holds together.
      const busy = SIDES.some((side) => d[side] && videoOf(side)?.seeking);
      const elapsed = busy ? 0 : Math.min((now - last) / 1000, MAX_TICK);
      last = now;

      u = clamp(u + (elapsed * speed) / span, 0, 1);

      const atEnd = speed > 0 ? u >= 1 : u <= 0;
      if (atEnd) {
        if (!loopRef.current) {
          applyU(speed > 0 ? 1 : 0);
          setPlaying(false);
          return;
        }
        u = speed > 0 ? 0 : 1;
      }

      const next = { ...timesRef.current };
      for (const side of SIDES) {
        const clip = d[side];
        if (!clip) continue;
        const t = sampleTime(clip, u);
        next[side] = t;
        const video = videoOf(side);
        if (!video || video.seeking) continue;
        // One seek per source frame, not per display frame: a 30fps clip at
        // 0.5× needs a new frame every 66ms, so asking 60 times a second would
        // be four wasted seeks out of five.
        if (Math.abs(video.currentTime - t) < frameDuration(clip) / 2) continue;
        video.currentTime = t;
      }

      timesRef.current = next;
      if (now - lastUiRef.current >= UI_INTERVAL) {
        lastUiRef.current = now;
        setTimes(next);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [applyU, currentU, playing, speed, videoOf]);

  /* ── Loading ─────────────────────────────────────────────────────────── */

  /**
   * Hand `side` a fresh object URL for the file it already holds.
   *
   * The URL being replaced is retired rather than revoked on the spot: the
   * element is still pointing at it until React commits the new `src`, and
   * pulling it out from underneath is itself a way to produce the media error
   * this function usually exists to repair. `handleReady` collects them once
   * the replacement is playing.
   */
  const mintUrl = React.useCallback((side: ClipSide, file: File) => {
    const previous = urlsRef.current[side];
    if (previous) staleUrlsRef.current.push(previous);
    const url = URL.createObjectURL(file);
    urlsRef.current = { ...urlsRef.current, [side]: url };
    filesRef.current = { ...filesRef.current, [side]: file };
    setSrcs((s) => ({ ...s, [side]: url }));
  }, []);

  const loadFile = React.useCallback(
    async (side: ClipSide, file: File) => {
      setLoading((l) => ({ ...l, [side]: true }));
      setError(null);
      try {
        const source = await probeVideo(file);
        mintUrl(side, file);
        retriedRef.current = { ...retriedRef.current, [side]: false };
        setLost((l) => ({ ...l, [side]: false }));

        // Picking a file for a side that already has markers keeps them — this
        // is how a restored session, or a source that had to be re-opened, gets
        // its pixels back without losing the work.
        const existing = docRef.current[side];
        const clip = existing ? replaceSource(existing, source) : createClip(source);
        const next = setClip(docRef.current, side, clip);
        // Re-derived on a fresh load only: the longer range as reference means
        // neither clip is forced past real time at 1×. A manual flip sticks.
        commit(existing ? next : setReference(next, longerSide(next)));
        writeTimes({ ...timesRef.current, [side]: clip.start });
        setPlaying(false);
        setFocus(side);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading((l) => ({ ...l, [side]: false }));
      }
    },
    [commit, mintUrl, writeTimes],
  );

  const pickFile = React.useCallback(
    (side: ClipSide, file: File) => void loadFile(side, file),
    [loadFile],
  );

  /**
   * A `<video>` reported an error.
   *
   * Left alone for long enough, a browser will drop the blob behind an object
   * URL — and the tab may be frozen or discarded outright to save memory. The
   * File is still here, so the first response is simply to mint a new URL from
   * it, which fixes the common case invisibly. If that fails too the file
   * itself has gone (moved, or evicted by iCloud), and only the user can
   * replace it; the markers are kept either way.
   */
  const handleMediaError = React.useCallback(
    (side: ClipSide) => {
      const file = filesRef.current[side];
      if (!file || retriedRef.current[side]) {
        setPlaying(false);
        setLost((l) => ({ ...l, [side]: true }));
        return;
      }
      retriedRef.current = { ...retriedRef.current, [side]: true };
      mintUrl(side, file);
    },
    [mintUrl],
  );

  /** A source that loads again is a source that recovered. */
  const handleReady = React.useCallback((side: ClipSide) => {
    retriedRef.current = { ...retriedRef.current, [side]: false };
    for (const url of staleUrlsRef.current.splice(0)) URL.revokeObjectURL(url);
    setLost((l) => (l[side] ? { ...l, [side]: false } : l));
  }, []);

  /* ── Editing ─────────────────────────────────────────────────────────── */

  /**
   * Marking changes the range, which changes what every master position means,
   * so the other clip is re-phased onto the new range straight away. The marked
   * clip does not move: `u` is derived from it, so it maps back to itself.
   */
  const markStart = React.useCallback(
    (side: ClipSide) => {
      commit(setStart(docRef.current, side, timesRef.current[side]));
      applyU(currentU());
    },
    [applyU, commit, currentU],
  );

  const markEnd = React.useCallback(
    (side: ClipSide) => {
      commit(setEnd(docRef.current, side, timesRef.current[side]));
      applyU(currentU());
    },
    [applyU, commit, currentU],
  );

  const nudge = React.useCallback(
    (side: ClipSide, frames: number) => {
      const next = nudgeOffset(docRef.current, side, frames);
      const u = currentU();
      commit(next);
      // The nudge is only visible if what is on screen moves with it.
      const clip = next[side];
      if (!clip) return;
      const t = sampleTime(clip, u);
      const video = videoOf(side);
      if (video) video.currentTime = t;
      writeTimes({ ...timesRef.current, [side]: t });
    },
    [commit, currentU, videoOf, writeTimes],
  );

  const resetSide = React.useCallback(
    (side: ClipSide) => commit(resetMarks(docRef.current, side)),
    [commit],
  );

  const clearSideOffset = React.useCallback(
    (side: ClipSide) => commit(clearOffset(docRef.current, side)),
    [commit],
  );

  const chooseReference = React.useCallback(
    (side: ClipSide) => commit(setReference(docRef.current, side)),
    [commit],
  );

  // While a marker is being dragged the clip shows the frame *at the marker* —
  // that is the thing being chosen. Re-phasing happens once, on release.
  const moveStart = React.useCallback(
    (side: ClipSide, t: number) => {
      setDoc(setStart(docRef.current, side, t));
      scrubClip(side, t);
    },
    [scrubClip, setDoc],
  );

  const moveEnd = React.useCallback(
    (side: ClipSide, t: number) => {
      setDoc(setEnd(docRef.current, side, t));
      scrubClip(side, t);
    },
    [scrubClip, setDoc],
  );

  const beginDrag = React.useCallback(
    (kind: Grab) => {
      // A marker drag is one undo step; scrubbing is not an edit at all.
      if (kind !== "scrub") {
        setPlaying(false);
        pushHistory();
      }
    },
    [pushHistory],
  );

  const endDrag = React.useCallback(
    (kind: Grab) => {
      // Scrubbing a single pane is *meant* to leave it off the master.
      if (kind !== "scrub") applyU(currentU());
    },
    [applyU, currentU],
  );

  const handleScrub = React.useCallback(
    (side: ClipSide, t: number) => {
      setPlaying(false);
      scrubClip(side, t);
      setDesynced(true);
    },
    [scrubClip],
  );

  /** The element resets to 0 on a new source; put it back where we think it is. */
  const restorePosition = React.useCallback(
    (side: ClipSide) => scrubClip(side, timesRef.current[side]),
    [scrubClip],
  );

  const resync = React.useCallback(() => applyU(currentU()), [applyU, currentU]);

  const restoreSaved = React.useCallback(() => {
    if (!saved) return;
    commit(saved);
    writeTimes({ a: saved.a?.start ?? 0, b: saved.b?.start ?? 0 });
    setSaved(null);
  }, [commit, saved, writeTimes]);

  const discardSaved = React.useCallback(() => {
    setSaved(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  }, []);

  const swapFocus = React.useCallback(() => {
    const d = docRef.current;
    setFocus((side) => (d[otherSide(side)] ? otherSide(side) : side));
  }, []);

  /* ── Surviving a long pause ──────────────────────────────────────────── */

  // The markers are the work and they are plain JSON, so they outlive the page.
  // The files cannot: a browser will not hand back filesystem access it was
  // given in a session that has ended.
  React.useEffect(() => {
    if (!doc.a && !doc.b) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeDoc(doc));
    } catch {
      // Private mode, or the quota is full. Not worth interrupting anyone over.
    }
  }, [doc]);

  // Deferred to a microtask rather than read in the effect body: the restore
  // offer is not needed for the first paint, and reading storage during render
  // would disagree with the prerendered HTML.
  React.useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      try {
        const text = window.localStorage.getItem(STORAGE_KEY);
        if (text) setSaved(parseDoc(text));
      } catch {
        // Storage unavailable; there is simply nothing to offer.
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // A hidden tab gets no animation frames, so the clock would otherwise resume
  // with a huge gap. MAX_TICK bounds the damage; stopping is the honest answer.
  React.useEffect(() => {
    const onHidden = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, []);

  /* ── Keyboard ────────────────────────────────────────────────────────── */

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (!referenceClip(docRef.current)) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod || e.altKey) return;

      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
        return;
      }

      const preset = Number(e.key);
      if (Number.isInteger(preset) && preset >= 1 && preset <= PRESET_RATES.length) {
        e.preventDefault();
        setSpeed(PRESET_RATES[preset - 1]);
        return;
      }

      switch (e.key.toLowerCase()) {
        case "q":
        case "arrowleft":
          e.preventDefault();
          stepFrames(e.shiftKey ? -10 : -1);
          return;
        case "w":
        case "arrowright":
          e.preventDefault();
          stepFrames(e.shiftKey ? 10 : 1);
          return;
        case "e":
          e.preventDefault();
          nudgeFocusSeconds(-0.5);
          return;
        case "r":
          e.preventDefault();
          nudgeFocusSeconds(0.5);
          return;
        case "s":
          e.preventDefault();
          setSpeed((prev) => stepRate(PRESET_RATES, prev, -1));
          return;
        case "d":
          e.preventDefault();
          setSpeed((prev) => stepRate(PRESET_RATES, prev, 1));
          return;
        case "a":
          e.preventDefault();
          markStart(focus);
          return;
        case "f":
          e.preventDefault();
          markEnd(focus);
          return;
        case "x":
          e.preventDefault();
          swapFocus();
          return;
        case "c":
          e.preventDefault();
          nudge(focus, -1);
          return;
        case "v":
          e.preventDefault();
          nudge(focus, 1);
          return;
        case "l":
          e.preventDefault();
          toggleLoop();
          return;
        case "escape":
          e.preventDefault();
          resetSide(focus);
          return;
        default:
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    focus,
    markEnd,
    markStart,
    nudge,
    nudgeFocusSeconds,
    redo,
    resetSide,
    stepFrames,
    swapFocus,
    toggleLoop,
    togglePlay,
    undo,
  ]);

  /* ── Render ──────────────────────────────────────────────────────────── */

  const refSide = referenceSide(doc);
  const ref = doc[refSide];
  const anyLoaded = ref !== null;
  const bothLoaded = doc.a !== null && doc.b !== null;
  const u = ref ? timeToU(ref, times[refSide]) : 0;

  // Only ever true after a pane was moved on its own — never from drift.
  const syncedOf = (side: ClipSide) => {
    const clip = doc[side];
    if (!desynced || !clip) return true;
    return Math.abs(times[side] - sampleTime(clip, u)) <= SYNC_TOLERANCE;
  };


  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">Compare</h1>
          <p className="text-xs text-text-secondary">
            Mark the same two moments — the toss and the contact — on both clips. The
            playhead then runs through both by <em>phase</em>, so they stay together even
            when one serve is slower.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex items-center overflow-hidden rounded-button border border-divider"
            role="group"
            aria-label="Layout"
          >
            {(
              [
                ["side", Columns2, "Side by side"],
                ["stacked", Rows2, "Stacked — better for wide footage"],
              ] as const
            ).map(([value, Icon, title]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLayout(value)}
                aria-pressed={layout === value}
                title={title}
                className={cn(
                  "px-2.5 py-1.5",
                  layout === value
                    ? "bg-accent text-background"
                    : "bg-surface text-text-secondary hover:text-text-primary",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>

          <div
            className="flex items-center overflow-hidden rounded-button border border-divider"
            role="group"
            aria-label="Viewport shape"
          >
            {(
              [
                ["wide", "16:9", "Wide window — more to see when zoomed in"],
                ["fit", "Fit", "Match the shape of the footage"],
              ] as const
            ).map(([value, text, title]) => (
              <button
                key={value}
                type="button"
                onClick={() => setViewport(value)}
                aria-pressed={viewport === value}
                title={title}
                className={
                  viewport === value
                    ? "bg-accent px-2.5 py-1.5 text-xs font-semibold text-background"
                    : "bg-surface px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                }
              >
                {text}
              </button>
            ))}
          </div>

          {bothLoaded && (
            <div
              className="flex items-center overflow-hidden rounded-button border border-divider"
              role="group"
              aria-label="Reference clip"
            >
              <span className="bg-surface px-2 py-1.5 text-[11px] uppercase tracking-wide text-text-secondary">
                ref
              </span>
              {SIDES.map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => chooseReference(side)}
                  aria-pressed={doc.reference === side}
                  title={`Clip ${side.toUpperCase()} defines master time and plays at true speed`}
                  className={
                    doc.reference === side
                      ? "bg-accent px-2.5 py-1.5 text-xs font-semibold text-background"
                      : "bg-surface px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                  }
                >
                  {side.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <Button
            variant={loop ? "primary" : "secondary"}
            size="sm"
            onClick={toggleLoop}
            aria-pressed={loop}
            title="Loop the comparison (L)"
          >
            <Repeat className="h-4 w-4" />
          </Button>

          <div className="ml-1 h-6 w-px bg-divider" aria-hidden />
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
      </header>

      {error && (
        <p className="rounded-small bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {saved && !doc.a && !doc.b && (
        <div className="flex flex-wrap items-center gap-3 rounded-small bg-accent-muted px-3 py-2 text-sm">
          <span className="flex-1">
            Markers from your last session are still here
            {saved.a && saved.b
              ? ` (${saved.a.source.name} and ${saved.b.source.name})`
              : ""}
            . Restore them, then open the same files again.
          </span>
          <Button size="sm" onClick={restoreSaved}>
            Restore markers
          </Button>
          <Button variant="ghost" size="sm" onClick={discardSaved}>
            Discard
          </Button>
        </div>
      )}

      <div className={cn("grid gap-4", layout === "side" && "lg:grid-cols-2")}>
        <ComparePane
          side="a"
          clip={doc.a}
          src={srcs.a}
          videoRef={videoARef}
          time={times.a}
          focused={focus === "a" && anyLoaded}
          isReference={refSide === "a" && bothLoaded}
          synced={syncedOf("a")}
          loading={loading.a}
          lost={lost.a}
          maxHeight={PANE_HEIGHT[layout]}
          boxAspect={BOX_ASPECT[viewport]}
          onFocus={setFocus}
          onPick={pickFile}
          onScrub={handleScrub}
          onMoveStart={moveStart}
          onMoveEnd={moveEnd}
          onGestureStart={beginDrag}
          onGestureEnd={endDrag}
          onSetStart={markStart}
          onSetEnd={markEnd}
          onResetMarks={resetSide}
          onNudge={nudge}
          onClearOffset={clearSideOffset}
          onResync={resync}
          onLoadedMetadata={restorePosition}
          onError={handleMediaError}
          onReady={handleReady}
        />
        <ComparePane
          side="b"
          clip={doc.b}
          src={srcs.b}
          videoRef={videoBRef}
          time={times.b}
          focused={focus === "b" && anyLoaded}
          isReference={refSide === "b" && bothLoaded}
          synced={syncedOf("b")}
          loading={loading.b}
          lost={lost.b}
          maxHeight={PANE_HEIGHT[layout]}
          boxAspect={BOX_ASPECT[viewport]}
          onFocus={setFocus}
          onPick={pickFile}
          onScrub={handleScrub}
          onMoveStart={moveStart}
          onMoveEnd={moveEnd}
          onGestureStart={beginDrag}
          onGestureEnd={endDrag}
          onSetStart={markStart}
          onSetEnd={markEnd}
          onResetMarks={resetSide}
          onNudge={nudge}
          onClearOffset={clearSideOffset}
          onResync={resync}
          onLoadedMetadata={restorePosition}
          onError={handleMediaError}
          onReady={handleReady}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => stepFrames(-1)}
          disabled={!anyLoaded}
          aria-label="Previous frame"
          title={`Back one frame of clip ${focus.toUpperCase()} (Q)`}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          onClick={togglePlay}
          disabled={!anyLoaded}
          aria-label={playing ? "Pause" : "Play"}
          title="Play both between the markers (Space)"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => stepFrames(1)}
          disabled={!anyLoaded}
          aria-label="Next frame"
          title={`Forward one frame of clip ${focus.toUpperCase()} (W)`}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="ml-1">
          <SpeedControl rate={speed} rates={PRESET_RATES} onChange={setSpeed} />
        </div>

        {ref && (
          <p className="ml-auto text-xs text-text-secondary">
            <span className="font-mono text-accent">
              {formatTimecode(uToMaster(doc, u), clipFps(ref))}
            </span>{" "}
            / {masterDuration(doc).toFixed(2)}s · {(u * 100).toFixed(0)}%
          </p>
        )}
      </div>

      <CompareTimeline doc={doc} u={u} onScrub={applyU} />

      <p className="text-xs text-text-secondary">
        <kbd className="rounded bg-surface px-1">A</kbd>
        <kbd className="ml-0.5 rounded bg-surface px-1">F</kbd> mark start/end ·{" "}
        <kbd className="rounded bg-surface px-1">X</kbd> swap clip ·{" "}
        <kbd className="rounded bg-surface px-1">Q</kbd>
        <kbd className="ml-0.5 rounded bg-surface px-1">W</kbd> frame ·{" "}
        <kbd className="rounded bg-surface px-1">E</kbd>
        <kbd className="ml-0.5 rounded bg-surface px-1">R</kbd> ±0.5s on that clip alone ·{" "}
        <kbd className="rounded bg-surface px-1">C</kbd>
        <kbd className="ml-0.5 rounded bg-surface px-1">V</kbd> nudge alignment ·{" "}
        <kbd className="rounded bg-surface px-1">S</kbd>
        <kbd className="ml-0.5 rounded bg-surface px-1">D</kbd> speed ·{" "}
        <kbd className="rounded bg-surface px-1">1</kbd>–
        <kbd className="rounded bg-surface px-1">5</kbd> preset ·{" "}
        <kbd className="rounded bg-surface px-1">L</kbd> loop ·{" "}
        <kbd className="rounded bg-surface px-1">Esc</kbd> whole clip
      </p>

      <p className="text-xs text-text-secondary">
        Scroll on a video to zoom in on it, drag to move it around, double-click to reset.
        Each pane zooms on its own. Playback seeks both clips from one clock, so they are
        always at the same phase — if a pair is heavy to decode it plays slow rather than
        drifting apart.
      </p>
    </div>
  );
}
