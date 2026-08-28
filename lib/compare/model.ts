/**
 * Compare document model — two clips, one normalised playhead.
 *
 * Two serves are never the same length, so the two ranges are compared by
 * *phase*, not by elapsed time: a single master position `u` (0 → 1) maps into
 * each clip's own marked range. At `u = 0.5` both clips are halfway through
 * their motion, whether that took 0.95s or 1.20s.
 *
 * Like `lib/reframe/model.ts` this module is deliberately dependency-free and
 * DOM-free, so the sync math can be tested under `node --experimental-strip-types`
 * and read without a browser in the room. Keep it that way.
 */

import { clamp } from "../reframe/model.ts";
// The probe output is the same shape for both tools; `probeVideo` returns this.
import type { ReframeSource } from "../reframe/model.ts";

export type { ReframeSource };

/** Assumed when the probe could not measure a frame rate. */
export const DEFAULT_FPS = 30;

/**
 * Playback is driven by *seeking* from one clock, not by playing the two
 * elements at matched `playbackRate`s. See `compare-viewer.tsx` for why; the
 * short version is that two independently-playing media elements cannot be held
 * together, and the failure mode is the pair tearing apart rather than slowing
 * down. It is also what the Swift app does — its comparison view has no play
 * button at all, only a scrubber that seeks both slots.
 */

export type ClipSide = "a" | "b";

export const SIDES: readonly ClipSide[] = ["a", "b"];

export interface CompareClip {
  source: ReframeSource;
  /** Start of the compared range, seconds from the start of the clip. */
  start: number;
  /** End of the compared range. Always at least one frame after `start`. */
  end: number;
  /**
   * Alignment nudge in seconds, added when sampling. It shifts what you see
   * without moving the markers, so you can fine-tune the lock-up by a frame or
   * two and still see the range you actually marked.
   */
  offset: number;
}

export interface CompareDoc {
  version: 1;
  a: CompareClip | null;
  b: CompareClip | null;
  /**
   * Which clip defines master time. The reference plays at exactly the
   * selected speed and one frame step is one of *its* frames — the two clips
   * can have different frame rates, so "one frame" is otherwise meaningless.
   */
  reference: ClipSide;
}

export const EMPTY_DOC: CompareDoc = { version: 1, a: null, b: null, reference: "a" };

/* ── Clips ─────────────────────────────────────────────────────────────── */

/**
 * A freshly dropped clip is marked as its whole self. There is no "not marked
 * yet" state to gate on: two clips can be compared end to end the moment they
 * load, and marking narrows that down rather than switching the tool on.
 */
export function createClip(source: ReframeSource): CompareClip {
  return { source, start: 0, end: source.duration, offset: 0 };
}

export function clipFps(clip: CompareClip): number {
  const fps = clip.source.frameRate;
  return fps && fps > 0 ? fps : DEFAULT_FPS;
}

export function frameDuration(clip: CompareClip): number {
  return 1 / clipFps(clip);
}

/** Length of the marked range, in seconds. Never zero for a loaded clip. */
export function clipDuration(clip: CompareClip): number {
  return clip.end - clip.start;
}

export function otherSide(side: ClipSide): ClipSide {
  return side === "a" ? "b" : "a";
}

export function bothLoaded(doc: CompareDoc): doc is CompareDoc & {
  a: CompareClip;
  b: CompareClip;
} {
  return doc.a !== null && doc.b !== null;
}

/**
 * The side actually acting as reference. With only one clip loaded it is that
 * clip, whichever side `reference` names — a half-loaded page still has a
 * working timeline.
 */
export function referenceSide(doc: CompareDoc): ClipSide {
  return doc[doc.reference] ? doc.reference : otherSide(doc.reference);
}

export function referenceClip(doc: CompareDoc): CompareClip | null {
  return doc[referenceSide(doc)];
}

/**
 * Master duration, in seconds — the reference clip's marked range. Zero when
 * nothing is loaded, which every caller treats as "no timeline yet".
 */
export function masterDuration(doc: CompareDoc): number {
  const ref = referenceClip(doc);
  return ref ? clipDuration(ref) : 0;
}

/**
 * The side whose range is longer. Used as the default reference so that at 1×
 * neither clip is ever forced to play faster than real time — the longer one
 * runs true and the shorter is slowed to match, which is the way round that
 * preserves detail.
 */
export function longerSide(doc: CompareDoc): ClipSide {
  if (!doc.a) return "b";
  if (!doc.b) return "a";
  return clipDuration(doc.b) > clipDuration(doc.a) ? "b" : "a";
}

/* ── Master ↔ clip time ────────────────────────────────────────────────── */

/**
 * Where in `clip` the master position `u` lands, in that clip's own seconds.
 *
 * The clamp to the clip bounds is the last line of defence: `offset` is
 * constrained so the shifted range stays inside the clip, but a document loaded
 * from elsewhere need not respect that.
 */
export function sampleTime(clip: CompareClip, u: number): number {
  const t = clip.start + clamp(u, 0, 1) * clipDuration(clip) + clip.offset;
  return clamp(t, 0, clip.source.duration);
}

/** The inverse: which master position a clip time corresponds to. */
export function timeToU(clip: CompareClip, t: number): number {
  const span = clipDuration(clip);
  if (span <= 0) return 0;
  return clamp((t - clip.offset - clip.start) / span, 0, 1);
}

export function masterToU(doc: CompareDoc, master: number): number {
  const d = masterDuration(doc);
  return d > 0 ? clamp(master / d, 0, 1) : 0;
}

export function uToMaster(doc: CompareDoc, u: number): number {
  return clamp(u, 0, 1) * masterDuration(doc);
}

/**
 * One frame of `side`, expressed as a step in `u`.
 *
 * Stepping is measured against the clip you are *looking at*, not always the
 * reference: whichever pane has focus advances by exactly one of its own
 * frames, and the other moves by however much of its own range that phase is
 * worth. Tying it to the reference would mean flipping the reference just to
 * step through the other clip properly.
 */
export function frameStepU(doc: CompareDoc, side: ClipSide = referenceSide(doc)): number {
  const clip = doc[side] ?? referenceClip(doc);
  if (!clip) return 0;
  const span = clipDuration(clip);
  return span > 0 ? frameDuration(clip) / span : 0;
}

/* ── Pane view (zoom + pan) ────────────────────────────────────────────── */

export const MAX_ZOOM = 8;

/**
 * How one pane is framed. `cx`/`cy` are the point of the video shown at the
 * centre of the box, normalised 0–1; `zoom` 1 is the whole frame.
 *
 * This is view state, not part of the comparison: it is never undoable and
 * never shared between the two panes, because the two clips are shot from
 * different places and the interesting corner is somewhere else in each.
 */
export interface PaneView {
  zoom: number;
  cx: number;
  cy: number;
}

export const DEFAULT_VIEW: PaneView = { zoom: 1, cx: 0.5, cy: 0.5 };

/**
 * How much of the box the picture actually covers, per axis, at zoom 1.
 *
 * The viewport is not the shape of the footage — a portrait clip in a 16:9 box
 * is letterboxed at the sides — so panning has to know where the picture ends,
 * not just where the box does. {@link FULL_FIT} is the matched case.
 */
export interface PaneFit {
  w: number;
  h: number;
}

export const FULL_FIT: PaneFit = { w: 1, h: 1 };

/** The picture's share of a box of aspect `boxAspect`, letterboxed to fit. */
export function paneFit(sourceAspect: number, boxAspect: number): PaneFit {
  if (!(sourceAspect > 0) || !(boxAspect > 0)) return FULL_FIT;
  return sourceAspect >= boxAspect
    ? { w: 1, h: boxAspect / sourceAspect }
    : { w: sourceAspect / boxAspect, h: 1 };
}

/**
 * Keep the box full of picture — or, when the picture is narrower than the box
 * and cannot fill it, keep it centred.
 *
 * At zoom `z` the visible window is `1/z` of the box, and the picture spans
 * `fit` of it, so there is `fit/2 - 0.5/z` of slack each way. Negative slack
 * means the picture does not reach the edges however you pan it, and the only
 * sensible place for it is the middle.
 */
export function clampView(view: PaneView, fit: PaneFit = FULL_FIT): PaneView {
  const zoom = clamp(view.zoom, 1, MAX_ZOOM);
  const axis = (v: number, extent: number) => {
    const slack = extent / 2 - 0.5 / zoom;
    return slack > 0 ? clamp(v, 0.5 - slack, 0.5 + slack) : 0.5;
  };
  return { zoom, cx: axis(view.cx, fit.w), cy: axis(view.cy, fit.h) };
}

/** The video point currently under box position `b` (both normalised 0–1). */
function pointUnder(centre: number, zoom: number, b: number): number {
  return (b - 0.5) / zoom + centre;
}

/**
 * Zoom by `factor`, keeping whatever is under (`bx`, `by`) where it is — so the
 * frame grows around the thing you pointed at rather than around the middle.
 */
export function zoomAt(
  view: PaneView,
  bx: number,
  by: number,
  factor: number,
  fit: PaneFit = FULL_FIT,
): PaneView {
  const zoom = clamp(view.zoom * factor, 1, MAX_ZOOM);
  const px = pointUnder(view.cx, view.zoom, bx);
  const py = pointUnder(view.cy, view.zoom, by);
  return clampView({ zoom, cx: px - (bx - 0.5) / zoom, cy: py - (by - 0.5) / zoom }, fit);
}

/** Drag the frame by a delta in box fractions. */
export function panBy(
  view: PaneView,
  dx: number,
  dy: number,
  fit: PaneFit = FULL_FIT,
): PaneView {
  return clampView(
    { ...view, cx: view.cx - dx / view.zoom, cy: view.cy - dy / view.zoom },
    fit,
  );
}

/**
 * The CSS transform for {@link PaneView}, for an element the size of its box
 * with `transform-origin: 50% 50%`.
 *
 * CSS applies transforms right to left, so this translates first and then
 * scales about the centre: a point `p` lands at `0.5 + zoom × (p + t - 0.5)`,
 * which puts `cx` in the middle exactly when `t = 0.5 - cx`.
 */
export function viewTransform(view: PaneView): string {
  const tx = (0.5 - view.cx) * 100;
  const ty = (0.5 - view.cy) * 100;
  return `scale(${view.zoom}) translate(${tx}%, ${ty}%)`;
}

/* ── Editing ───────────────────────────────────────────────────────────── */

function withClip(doc: CompareDoc, side: ClipSide, clip: CompareClip): CompareDoc {
  return { ...doc, [side]: clip };
}

export function setClip(doc: CompareDoc, side: ClipSide, clip: CompareClip | null): CompareDoc {
  return { ...doc, [side]: clip };
}

/**
 * Mark the start of the compared range at `t`.
 *
 * Marking a start at or past the current end means "start over from here", not
 * "collapse the range to a single frame". Clamping would be the obvious rule
 * and the wrong one: pressing the key at 40s with a range at 10–12s would leave
 * a one-frame range at 12s, nowhere near where you were looking.
 */
export function setStart(doc: CompareDoc, side: ClipSide, t: number): CompareDoc {
  const clip = doc[side];
  if (!clip) return doc;
  const min = frameDuration(clip);
  const start = clamp(t, 0, Math.max(0, clip.source.duration - min));
  const end = start + min > clip.end ? clip.source.duration : clip.end;
  return withClip(doc, side, clampOffset({ ...clip, start, end }));
}

/** Mark the end of the range. Mirror image of {@link setStart}. */
export function setEnd(doc: CompareDoc, side: ClipSide, t: number): CompareDoc {
  const clip = doc[side];
  if (!clip) return doc;
  const min = frameDuration(clip);
  const end = clamp(t, min, clip.source.duration);
  const start = end - min < clip.start ? 0 : clip.start;
  return withClip(doc, side, clampOffset({ ...clip, start, end }));
}

/** Drop the markers back to the whole clip, keeping the alignment nudge. */
export function resetMarks(doc: CompareDoc, side: ClipSide): CompareDoc {
  const clip = doc[side];
  if (!clip) return doc;
  return withClip(
    doc,
    side,
    clampOffset({ ...clip, start: 0, end: clip.source.duration }),
  );
}

/**
 * Keep the nudged range inside the clip. Without this the offset could be
 * wound past the end, where `sampleTime` clamps every `u` to the same frame and
 * the pane looks frozen for no visible reason.
 */
function clampOffset(clip: CompareClip): CompareClip {
  const lo = -clip.start;
  const hi = clip.source.duration - clip.end;
  return { ...clip, offset: clamp(clip.offset, Math.min(0, lo), Math.max(0, hi)) };
}

export function nudgeOffset(doc: CompareDoc, side: ClipSide, frames: number): CompareDoc {
  const clip = doc[side];
  if (!clip) return doc;
  const offset = clip.offset + frames * frameDuration(clip);
  return withClip(doc, side, clampOffset({ ...clip, offset }));
}

export function clearOffset(doc: CompareDoc, side: ClipSide): CompareDoc {
  const clip = doc[side];
  if (!clip) return doc;
  return withClip(doc, side, { ...clip, offset: 0 });
}

/**
 * Point a clip at a freshly read source, keeping its markers.
 *
 * Used when a source has to be re-opened — a re-minted object URL after the
 * browser dropped the old one, or the same file picked again after a reload.
 * The markers are the work; the file is just where the pixels come from.
 */
export function replaceSource(clip: CompareClip, source: ReframeSource): CompareClip {
  if (!(source.duration > 0)) return createClip(source);
  const min = 1 / (source.frameRate && source.frameRate > 0 ? source.frameRate : DEFAULT_FPS);
  // A shorter file cannot hold the old range, so keep as much as still fits.
  const end = clamp(clip.end, Math.min(min, source.duration), source.duration);
  const start = clamp(clip.start, 0, Math.max(0, end - min));
  return clampOffset({ source, start, end, offset: clip.offset });
}

/* ── Persistence ───────────────────────────────────────────────────────── */

export function serializeDoc(doc: CompareDoc): string {
  return JSON.stringify(doc);
}

/**
 * Tolerant parse — returns null rather than throwing.
 *
 * The only caller restores from browser storage after the page went away, where
 * a half-written or stale-shaped record is not worth an error message. Clips
 * are validated one at a time so a corrupt B does not lose a good A.
 */
export function parseDoc(text: string): CompareDoc | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) return null;

  const a = parseClip(record.a);
  const b = parseClip(record.b);
  if (!a && !b) return null;
  return { version: 1, a, b, reference: record.reference === "b" ? "b" : "a" };
}

function parseClip(raw: unknown): CompareClip | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const source = c.source as Record<string, unknown> | undefined;
  if (!source) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const width = num(source.width);
  const height = num(source.height);
  const duration = num(source.duration);
  if (!width || !height || duration === null || duration <= 0) return null;

  // Optional fields are omitted rather than set to `undefined`, so a restored
  // document is deep-equal to the one that was written.
  const parsed: ReframeSource = {
    width,
    height,
    duration,
    name: typeof source.name === "string" ? source.name : "clip",
  };
  const frameRate = num(source.frameRate);
  if (frameRate !== null) parsed.frameRate = frameRate;
  if (typeof source.colorSpace === "string") parsed.colorSpace = source.colorSpace;
  if (typeof source.hdr === "boolean") parsed.hdr = source.hdr;

  const clip: CompareClip = {
    source: parsed,
    start: num(c.start) ?? 0,
    end: num(c.end) ?? duration,
    offset: num(c.offset) ?? 0,
  };
  // Run it through the same repair path a re-opened file takes.
  return replaceSource(clip, clip.source);
}

export function setReference(doc: CompareDoc, side: ClipSide): CompareDoc {
  return { ...doc, reference: side };
}
