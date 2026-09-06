/**
 * Reframe document model — the portable description of a 16:9 → 9:16 reframe.
 *
 * This module is deliberately dependency-free and DOM-free: it is the shared
 * contract between the web editor, a future ARoundNet (Swift/AVFoundation)
 * implementation, and anything else that needs to reproduce the same crop.
 * Keep it that way — everything here must be expressible as a plain JSON
 * document and as a Codable Swift struct. See docs/reframe-format.md.
 */

/** How the crop travels from this keyframe to the next one. */
export type Easing =
  /** Constant velocity. */
  | "linear"
  /** Smoothstep — decelerates into the next keyframe. The default. */
  | "easeInOut"
  /** No motion: the crop stays put, then jumps at the next keyframe. */
  | "hold";

export const EASINGS: readonly Easing[] = ["easeInOut", "linear", "hold"];

export interface ReframeKeyframe {
  /** Stable id, editor-local. Not meaningful across documents. */
  id: string;
  /** Time in seconds from the start of the source video. */
  t: number;
  /** Centre of the crop window, normalised 0–1 in source coordinates. */
  cx: number;
  cy: number;
  /**
   * Crop tightness. 1 = the largest target-aspect rect that fits in the
   * source; 2 = half that size (a 2× punch-in). Always >= 1.
   */
  zoom: number;
  /** Governs the segment from this keyframe to the following one. */
  easing: Easing;
}

export interface ReframeSource {
  /** Display dimensions in pixels, after rotation/pixel-aspect correction. */
  width: number;
  height: number;
  /** Duration in seconds. */
  duration: number;
  /** Original filename, for display and for naming the export. */
  name: string;
  /** Measured frame rate, if known. Used to size frame-step and export. */
  frameRate?: number;
  /**
   * Informational only — the solver and exporter ignore these. They describe
   * the source's colour, which matters because the export round-trips frames
   * through an sRGB canvas: wide-gamut or HDR footage is converted on the way
   * through, and that conversion is visible in the result.
   */
  colorSpace?: string;
  hdr?: boolean;
}

export interface ReframeDoc {
  version: 1;
  source: ReframeSource;
  /** Output pixel dimensions. Its aspect ratio drives the crop shape. */
  target: { width: number; height: number };
  /** Sorted ascending by `t`. Use the helpers below to preserve that. */
  keyframes: ReframeKeyframe[];
  /**
   * The parts of the source worth keeping, sorted by `start` and never
   * overlapping. Empty means "the whole clip" — which is what every document
   * written before segments existed deserialises to, so `version` stays 1.
   */
  segments: ReframeSegment[];
  /**
   * Colour grade applied at export. Absent means {@link DEFAULT_GRADE}, which
   * is what every document written before grading existed deserialises to —
   * `version` stays 1, same policy as `segments`.
   */
  grade?: ReframeGrade;
}

/* ── Colour grade ──────────────────────────────────────────────────────── */

/**
 * The tone-map operator the exporter runs on HDR sources. `"none"` restores
 * the pre-grading behaviour: the browser's own HDR→SDR conversion on the 2D
 * canvas path, which is what used to wash the colour out.
 */
export type ReframeToneMap = "hable" | "reinhard" | "none";

export const TONE_MAPS: readonly ReframeToneMap[] = ["hable", "reinhard", "none"];

export interface ReframeGrade {
  /** Stops, applied to linear light BEFORE tone mapping. */
  exposure: number;
  /** CSS `saturate()` amount, applied after the output OETF. */
  saturation: number;
  /** CSS `contrast()` amount, applied after the output OETF. */
  contrast: number;
  toneMap: ReframeToneMap;
}

export const DEFAULT_GRADE: ReframeGrade = {
  exposure: 0,
  saturation: 1,
  contrast: 1,
  toneMap: "hable",
};

/** The document's grade, defaulted — never null. */
export function gradeOf(doc: ReframeDoc): ReframeGrade {
  return doc.grade ?? DEFAULT_GRADE;
}

export function gradesEqual(a: ReframeGrade, b: ReframeGrade): boolean {
  return (
    a.exposure === b.exposure &&
    a.saturation === b.saturation &&
    a.contrast === b.contrast &&
    a.toneMap === b.toneMap
  );
}

/**
 * Patch the grade. When the result equals {@link DEFAULT_GRADE} the key is
 * dropped entirely, so documents that predate grading round-trip byte-stable.
 */
export function setGrade(doc: ReframeDoc, patch: Partial<ReframeGrade>): ReframeDoc {
  const next = { ...gradeOf(doc), ...patch };
  if (gradesEqual(next, DEFAULT_GRADE)) {
    if (doc.grade === undefined) return doc;
    const rest = { ...doc };
    delete rest.grade;
    return rest;
  }
  return { ...doc, grade: next };
}

/**
 * Read the `grade` of a saved document, clamping and repairing rather than
 * rejecting — the same policy as {@link parseSegments}. Returns undefined for
 * anything that resolves to the default, mirroring {@link setGrade}.
 */
export function parseGrade(raw: unknown): ReframeGrade | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const g = raw as Partial<ReframeGrade>;
  const grade: ReframeGrade = {
    exposure: typeof g.exposure === "number" ? clamp(g.exposure, -4, 4) : DEFAULT_GRADE.exposure,
    saturation:
      typeof g.saturation === "number" ? clamp(g.saturation, 0, 3) : DEFAULT_GRADE.saturation,
    contrast: typeof g.contrast === "number" ? clamp(g.contrast, 0, 3) : DEFAULT_GRADE.contrast,
    toneMap: TONE_MAPS.includes(g.toneMap as ReframeToneMap)
      ? (g.toneMap as ReframeToneMap)
      : DEFAULT_GRADE.toneMap,
  };
  return gradesEqual(grade, DEFAULT_GRADE) ? undefined : grade;
}

/**
 * A kept range of the source. Half-open: `[start, end)`.
 *
 * The iOS app's `VideoSegment` is the same idea with normalised bounds; see
 * {@link toNormalisedSegment} / {@link fromNormalisedSegment} for the bridge.
 * This model uses seconds because keyframe `t` is in seconds and the two are
 * compared on every solve — mixing units there is how the TS and Swift ports
 * would quietly diverge.
 */
export interface ReframeSegment {
  /** Stable id, editor-local. Not meaningful across documents. */
  id: string;
  /** Display name. Auto-assigned "Point 1"; a typed name is preserved. */
  name: string;
  /** Seconds from the start of the source. Always `start < end`. */
  start: number;
  end: number;
}

/**
 * Output shapes. 9:16 is what the editor was built for, but the solver has
 * never cared about the ratio — at 16:9 from a 16:9 source with no keyframes
 * the crop is the whole frame, which makes the editor a plain trimmer.
 */
export type TargetAspect = "9:16" | "4:5" | "1:1" | "16:9";

/** Ordered tallest to widest, which is how the picker reads. */
export const TARGET_ASPECTS: readonly TargetAspect[] = ["9:16", "4:5", "1:1", "16:9"];

export interface TargetSize {
  width: number;
  height: number;
}

/**
 * Size tiers per aspect, ascending, and index-aligned across aspects so
 * switching shape keeps the tier you picked. Named by the *smaller* dimension
 * — 720, 1080, 1440, 2160 — which is the one every platform quotes.
 *
 * All dimensions are even: H.264 4:2:0 requires it.
 */
export const TARGET_PRESETS: Record<TargetAspect, readonly TargetSize[]> = {
  "9:16": [
    { width: 720, height: 1280 },
    { width: 1080, height: 1920 },
    { width: 1440, height: 2560 },
    { width: 2160, height: 3840 },
  ],
  "4:5": [
    { width: 720, height: 900 },
    { width: 1080, height: 1350 },
    { width: 1440, height: 1800 },
    { width: 2160, height: 2700 },
  ],
  "1:1": [
    { width: 720, height: 720 },
    { width: 1080, height: 1080 },
    { width: 1440, height: 1440 },
    { width: 2160, height: 2160 },
  ],
  "16:9": [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 3840, height: 2160 },
  ],
};

/** 1080 is what Reels and TikTok expect, so it is the tier new documents get. */
export const DEFAULT_TARGET: TargetSize = TARGET_PRESETS["9:16"][1];

/**
 * Which preset a target is, or null when it is a size the presets don't
 * cover (a hand-edited document, say — which stays perfectly valid).
 */
export function findTargetPreset(
  target: TargetSize,
): { aspect: TargetAspect; index: number } | null {
  for (const aspect of TARGET_ASPECTS) {
    const index = TARGET_PRESETS[aspect].findIndex(
      (p) => p.width === target.width && p.height === target.height,
    );
    if (index >= 0) return { aspect, index };
  }
  return null;
}

let idCounter = 0;

/** Editor-local unique id for a keyframe. */
export function newKeyframeId(): string {
  idCounter += 1;
  return `kf${idCounter}_${Math.random().toString(36).slice(2, 7)}`;
}
const nextId = newKeyframeId;

/**
 * How close two keyframes must be, in seconds, to count as "the same one".
 * Half a frame: tapping twice on a paused frame edits that keyframe, but
 * adjacent frames can still hold separate keyframes.
 */
export function keyframeEpsilon(doc: ReframeDoc): number {
  return 0.5 / (doc.source.frameRate && doc.source.frameRate > 0 ? doc.source.frameRate : 30);
}

export function createDoc(
  source: ReframeSource,
  target: TargetSize = DEFAULT_TARGET,
): ReframeDoc {
  return { version: 1, source, target, keyframes: [], segments: [] };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Insert a keyframe, or replace the one already sitting at `t`.
 *
 * "Already sitting at `t`" is fuzzy by `epsilon` seconds so that tapping twice
 * on the same paused frame edits that keyframe instead of stacking a second
 * one on top of it (which would produce a zero-length, un-editable segment).
 */
export function upsertKeyframe(
  doc: ReframeDoc,
  kf: Omit<ReframeKeyframe, "id" | "easing"> & Partial<Pick<ReframeKeyframe, "id" | "easing">>,
  epsilon = 1e-3,
): ReframeDoc {
  const existing = doc.keyframes.find((k) => Math.abs(k.t - kf.t) <= epsilon);
  const merged: ReframeKeyframe = {
    id: kf.id ?? existing?.id ?? nextId(),
    t: kf.t,
    cx: kf.cx,
    cy: kf.cy,
    zoom: kf.zoom,
    easing: kf.easing ?? existing?.easing ?? "easeInOut",
  };
  const rest = doc.keyframes.filter((k) => k.id !== merged.id && Math.abs(k.t - kf.t) > epsilon);
  return { ...doc, keyframes: [...rest, merged].sort((a, b) => a.t - b.t) };
}

export function updateKeyframe(
  doc: ReframeDoc,
  id: string,
  patch: Partial<Omit<ReframeKeyframe, "id">>,
): ReframeDoc {
  const keyframes = doc.keyframes
    .map((k) => (k.id === id ? { ...k, ...patch } : k))
    .sort((a, b) => a.t - b.t);
  return { ...doc, keyframes };
}

export function removeKeyframe(doc: ReframeDoc, id: string): ReframeDoc {
  return { ...doc, keyframes: doc.keyframes.filter((k) => k.id !== id) };
}

/** The keyframe nearest to `t`, within `tolerance` seconds — else null. */
export function keyframeNear(
  doc: ReframeDoc,
  t: number,
  tolerance: number,
): ReframeKeyframe | null {
  let best: ReframeKeyframe | null = null;
  let bestDelta = Infinity;
  for (const k of doc.keyframes) {
    const delta = Math.abs(k.t - t);
    if (delta <= tolerance && delta < bestDelta) {
      best = k;
      bestDelta = delta;
    }
  }
  return best;
}

/* ── Serialisation ─────────────────────────────────────────────────────── */

export function serializeDoc(doc: ReframeDoc): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Parse a saved document, validating enough of it that a hand-edited or
 * stale file fails loudly here rather than producing a silently wrong crop.
 */
export function parseDoc(json: string): ReframeDoc {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null) throw new Error("Not a reframe document.");
  const d = raw as Partial<ReframeDoc>;
  if (d.version !== 1) throw new Error(`Unsupported reframe version: ${String(d.version)}`);
  if (!d.source || !d.target || !Array.isArray(d.keyframes)) {
    throw new Error("Reframe document is missing source, target or keyframes.");
  }
  const { width, height, duration } = d.source;
  if (!(width > 0) || !(height > 0) || !(duration > 0)) {
    throw new Error("Reframe document has invalid source dimensions.");
  }
  if (!(d.target.width > 0) || !(d.target.height > 0)) {
    throw new Error("Reframe document has invalid target dimensions.");
  }
  const keyframes = d.keyframes.map((k, i): ReframeKeyframe => {
    if (typeof k?.t !== "number" || typeof k?.cx !== "number" || typeof k?.cy !== "number") {
      throw new Error(`Keyframe ${i} is missing t/cx/cy.`);
    }
    return {
      id: typeof k.id === "string" ? k.id : nextId(),
      t: k.t,
      cx: clamp(k.cx, 0, 1),
      cy: clamp(k.cy, 0, 1),
      zoom: typeof k.zoom === "number" && k.zoom >= 1 ? k.zoom : 1,
      easing: EASINGS.includes(k.easing) ? k.easing : "easeInOut",
    };
  });
  keyframes.sort((a, b) => a.t - b.t);
  const doc: ReframeDoc = {
    version: 1,
    source: { ...d.source, name: d.source.name ?? "video" },
    target: { width: d.target.width, height: d.target.height },
    keyframes,
    segments: [],
  };
  const grade = parseGrade(d.grade);
  return { ...doc, segments: parseSegments(doc, d.segments), ...(grade ? { grade } : {}) };
}

/**
 * Fit a saved document onto the video that is actually open.
 *
 * Two callers rely on this and must not drift apart: importing a `.reframe.json`
 * by hand, and restoring the autosaved copy when a file is recognised. Both
 * arrive at the same problem — a document written elsewhere, against footage
 * that may not be byte-identical to what is loaded now.
 *
 * Keyframe positions are normalised, so a document saved against a different
 * encode of the same shot still applies; the *loaded* video's real metadata is
 * kept and only the framing is taken from the document. Segment bounds are in
 * seconds, though, so they are clamped to this video's duration and re-merged —
 * a document from a longer source would otherwise carry segments sitting past
 * the end that never render.
 *
 * `aspectMismatch` is advisory: differing aspect ratios mean the framing will
 * look wrong, but it is not a reason to refuse the document.
 */
export function applyLoadedDoc(
  current: ReframeDoc,
  loaded: ReframeDoc,
): { doc: ReframeDoc; aspectMismatch: boolean } {
  const segments = loaded.segments
    .map((seg) => ({
      ...seg,
      start: Math.min(seg.start, current.source.duration),
      end: Math.min(seg.end, current.source.duration),
    }))
    .filter((seg) => seg.end - seg.start > 0);

  const doc = normaliseSegments({
    ...current,
    target: loaded.target,
    keyframes: loaded.keyframes,
    segments,
  });

  const aspectMismatch =
    Math.abs(
      loaded.source.width / loaded.source.height -
        current.source.width / current.source.height,
    ) > 0.01;

  return { doc, aspectMismatch };
}

/**
 * Read the `segments` array of a saved document, repairing rather than
 * rejecting: a missing key means "no segments", and overlapping or reversed
 * ranges from a hand-edited file are merged and clamped into shape. This
 * mirrors how keyframes are already clamped above.
 */
function parseSegments(doc: ReframeDoc, raw: unknown): ReframeSegment[] {
  if (!Array.isArray(raw)) return [];
  const parsed: ReframeSegment[] = [];
  for (const s of raw as Partial<ReframeSegment>[]) {
    if (typeof s?.start !== "number" || typeof s?.end !== "number") continue;
    const start = clamp(Math.min(s.start, s.end), 0, doc.source.duration);
    const end = clamp(Math.max(s.start, s.end), 0, doc.source.duration);
    if (end - start <= 0) continue;
    parsed.push({
      id: typeof s.id === "string" ? s.id : newSegmentId(),
      name: typeof s.name === "string" && s.name.trim() ? s.name : "Point",
      start,
      end,
    });
  }
  return renumberSegments(mergeSegments(parsed, segmentEpsilon(doc)));
}

/* ── Segments ──────────────────────────────────────────────────────────── */

/** Editor-local unique id for a segment. */
export function newSegmentId(): string {
  idCounter += 1;
  return `seg${idCounter}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Seconds of run-up captured when Out is pressed in a gap with no In. */
export const GAP_LEAD_IN = 5;

/**
 * Past an open in-point by more than this, In is read as a slip for Out.
 *
 * A feel decision, not a law: nudging an in-point a second or two later is a
 * real correction, but jumping it thirty seconds later while marking a rally
 * has always turned out to be the wrong finger.
 */
export const IN_AS_OUT_SLIP = 3;

/** The shortest segment the editor will create: one frame. */
export function minSegmentDuration(doc: ReframeDoc): number {
  return 2 * keyframeEpsilon(doc);
}

/** Half a frame — the same tolerance keyframes use for "the same spot". */
export function segmentEpsilon(doc: ReframeDoc): number {
  return keyframeEpsilon(doc);
}

/** Auto-assigned names, which renumbering is free to rewrite. */
const AUTO_NAME = /^Point( \d+)?$/;

/**
 * Sort by start and fold overlapping or touching ranges into one, so the list
 * can never become a tangle no matter how the markers were pressed. The
 * earlier segment's id and name win, which is what lets a typed name and the
 * current selection survive a merge.
 */
export function mergeSegments(segments: ReframeSegment[], epsilon: number): ReframeSegment[] {
  const merged: ReframeSegment[] = [];
  for (const seg of [...segments].sort((a, b) => a.start - b.start)) {
    const prev = merged[merged.length - 1];
    if (prev && seg.start <= prev.end + epsilon) {
      prev.end = Math.max(prev.end, seg.end);
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

/** Renumber "Point N" names in time order, leaving typed names alone. */
export function renumberSegments(segments: ReframeSegment[]): ReframeSegment[] {
  return segments.map((seg, i) =>
    AUTO_NAME.test(seg.name) ? { ...seg, name: `Point ${i + 1}` } : seg,
  );
}

/**
 * Add a range, merging it into any neighbour it touches.
 *
 * Returns the id of the segment that now covers it — which is *not* always the
 * one just created, because merging keeps the earlier segment's identity.
 */
export function addSegment(
  doc: ReframeDoc,
  start: number,
  end: number,
  name?: string,
): { doc: ReframeDoc; segmentId: string } {
  const min = minSegmentDuration(doc);
  const duration = doc.source.duration;
  let lo = clamp(Math.min(start, end), 0, duration);
  let hi = clamp(Math.max(start, end), 0, duration);
  if (hi - lo < min) {
    hi = Math.min(duration, lo + min);
    if (hi - lo < min) lo = Math.max(0, hi - min);
  }

  const id = newSegmentId();
  const segments = renumberSegments(
    mergeSegments(
      [...doc.segments, { id, name: name ?? "Point", start: lo, end: hi }],
      segmentEpsilon(doc),
    ),
  );
  const landed =
    segments.find((s) => s.id === id) ??
    segments.find((s) => lo >= s.start - 1e-9 && lo <= s.end + 1e-9);
  return { doc: { ...doc, segments }, segmentId: landed?.id ?? id };
}

/**
 * Clamp-only edit. Deliberately does NOT merge: merging on every pointermove
 * of an edge drag would dissolve the segment under the pointer mid-gesture and
 * leave the drag targeting a dead id. Call {@link normaliseSegments} on
 * pointer-up instead.
 */
export function updateSegment(
  doc: ReframeDoc,
  id: string,
  patch: Partial<Omit<ReframeSegment, "id">>,
): ReframeDoc {
  const min = minSegmentDuration(doc);
  const duration = doc.source.duration;
  const segments = doc.segments.map((seg) => {
    if (seg.id !== id) return seg;
    const next = { ...seg, ...patch };
    let start = clamp(next.start, 0, duration);
    let end = clamp(next.end, 0, duration);
    if (end - start < min) {
      // Hold the edge that wasn't dragged and push the dragged one back.
      if (patch.start !== undefined) {
        start = Math.min(start, end - min);
        if (start < 0) {
          start = 0;
          end = Math.min(duration, min);
        }
      } else {
        end = Math.max(end, start + min);
        if (end > duration) {
          end = duration;
          start = Math.max(0, end - min);
        }
      }
    }
    return { ...next, start, end };
  });
  return { ...doc, segments };
}

/** Sort, merge and renumber. Run once at the end of an edit gesture. */
export function normaliseSegments(doc: ReframeDoc): ReframeDoc {
  return {
    ...doc,
    segments: renumberSegments(mergeSegments(doc.segments, segmentEpsilon(doc))),
  };
}

export function removeSegment(doc: ReframeDoc, id: string): ReframeDoc {
  return { ...doc, segments: renumberSegments(doc.segments.filter((s) => s.id !== id)) };
}

export function clearSegments(doc: ReframeDoc): ReframeDoc {
  return { ...doc, segments: [] };
}

/** The segment containing `t`. Half-open, so segments never both claim a frame. */
export function segmentAt(doc: ReframeDoc, t: number): ReframeSegment | null {
  return doc.segments.find((s) => t >= s.start && t < s.end) ?? null;
}

export function totalSegmentDuration(doc: ReframeDoc): number {
  return doc.segments.reduce((total, s) => total + (s.end - s.start), 0);
}

/** The un-kept stretches between segments, for dimming the timeline. */
export function gapRanges(doc: ReframeDoc): Array<{ start: number; end: number }> {
  if (doc.segments.length === 0) return [];
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const seg of doc.segments) {
    if (seg.start > cursor) gaps.push({ start: cursor, end: seg.start });
    cursor = Math.max(cursor, seg.end);
  }
  if (cursor < doc.source.duration) gaps.push({ start: cursor, end: doc.source.duration });
  return gaps;
}

/**
 * The ranges an export renders, joined end to end. With no segments that is
 * the whole clip, which is why the exporter needed no special-casing to keep
 * working on documents that predate segments.
 *
 * Sub-frame ranges are dropped: they would contribute no frames while still
 * advancing the output clock, freezing the picture for their duration.
 */
export function exportRanges(doc: ReframeDoc): Array<{ start: number; end: number }> {
  if (doc.segments.length === 0) return [{ start: 0, end: doc.source.duration }];
  const min = minSegmentDuration(doc);
  return doc.segments
    .filter((s) => s.end - s.start >= min)
    .map((s) => ({ start: s.start, end: s.end }));
}

/**
 * Where playback continues from `t` when only segments are played: `t` itself
 * inside a segment, the next segment's start in a gap, and null once there is
 * nothing left to play.
 */
export function nextPlayTime(doc: ReframeDoc, t: number): number | null {
  if (doc.segments.length === 0) return t;
  if (segmentAt(doc, t)) return t;
  const next = doc.segments.find((s) => s.start > t);
  return next ? next.start : null;
}

/* ── Marker state machine ──────────────────────────────────────────────── */

/**
 * The in-point of the segment being marked. Transient editor state, not part
 * of the saved document, but passed in and out as a plain value so the whole
 * machine is testable without React.
 */
export interface MarkState {
  /** Seconds, or null when no segment is open. */
  openIn: number | null;
}

export const NO_MARK: MarkState = { openIn: null };

export interface MarkResult {
  doc: ReframeDoc;
  mark: MarkState;
  /** The segment created or touched, for selection. */
  segmentId: string | null;
}

/**
 * In, unconditionally — "the in-point is *here*", whatever the playhead is
 * doing. Bound to Shift+In, and the escape hatch from {@link markIn}'s
 * forgiveness below.
 *
 * It never modifies a committed segment, which is what makes overshooting free
 * (rewind and press again) and what makes inserting a missed point into a gap
 * safe: the neighbours cannot be disturbed.
 */
export function forceMarkIn(doc: ReframeDoc, _mark: MarkState, t: number): MarkResult {
  return { doc, mark: { openIn: clamp(t, 0, doc.source.duration) }, segmentId: null };
}

/**
 * In — sets the in-point, but forgives the common slip.
 *
 * Once the playhead has run more than {@link IN_AS_OUT_SLIP} past an open
 * in-point, pressing In is almost always a mis-fire for Out: the alternative
 * reading — "discard the start of the rally I am part-way through capturing"
 * — is one nobody intends. So it commits the segment instead.
 *
 * Moving an in-point *earlier*, or later by a second or two, is a genuine
 * correction and still works. Use {@link forceMarkIn} to move it further ahead.
 */
export function markIn(doc: ReframeDoc, mark: MarkState, t: number): MarkResult {
  const now = clamp(t, 0, doc.source.duration);
  if (mark.openIn !== null && now - mark.openIn > IN_AS_OUT_SLIP) {
    return markOut(doc, mark, now);
  }
  return forceMarkIn(doc, mark, now);
}

/** Discard an open in-point without committing anything. Bound to Escape. */
export function cancelMark(doc: ReframeDoc): MarkResult {
  return { doc, mark: NO_MARK, segmentId: null };
}

/**
 * Out — "close it *here*". Three cases, none of which reach across a gap to
 * touch a distant segment, and none of which can error.
 */
export function markOut(doc: ReframeDoc, mark: MarkState, t: number): MarkResult {
  const now = clamp(t, 0, doc.source.duration);

  // 1. A draft is open: commit it. min/max so scrubbing backwards still works.
  if (mark.openIn !== null) {
    const { doc: next, segmentId } = addSegment(doc, mark.openIn, now);
    return { doc: next, mark: NO_MARK, segmentId };
  }

  // 2. Inside a committed segment: this point ran a bit longer.
  const inside = segmentAt(doc, now);
  if (inside) {
    const extended = normaliseSegments(
      updateSegment(doc, inside.id, {
        end: Math.max(now, inside.start + minSegmentDuration(doc)),
      }),
    );
    const landed = extended.segments.find(
      (s) => inside.start >= s.start - 1e-9 && inside.start <= s.end + 1e-9,
    );
    return { doc: extended, mark: NO_MARK, segmentId: landed?.id ?? null };
  }

  // 3. In a gap: capture the run-up to here — "damn, I missed that point".
  //    Clamped to the previous segment's end so it can never swallow it.
  const previousEnd = doc.segments.reduce(
    (acc, s) => (s.end <= now ? Math.max(acc, s.end) : acc),
    0,
  );
  const { doc: next, segmentId } = addSegment(
    doc,
    Math.max(previousEnd, now - GAP_LEAD_IN),
    now,
  );
  return { doc: next, mark: NO_MARK, segmentId };
}

/* ── Bridge to the iOS VideoSegment shape ──────────────────────────────── */

export function toNormalisedSegment(
  doc: ReframeDoc,
  seg: ReframeSegment,
): { id: string; name: string; startNormalised: number; endNormalised: number } {
  const duration = doc.source.duration || 1;
  return {
    id: seg.id,
    name: seg.name,
    startNormalised: seg.start / duration,
    endNormalised: seg.end / duration,
  };
}

export function fromNormalisedSegment(
  doc: ReframeDoc,
  n: { id?: string; name?: string; startNormalised: number; endNormalised: number },
): ReframeSegment {
  const duration = doc.source.duration;
  return {
    id: n.id ?? newSegmentId(),
    name: n.name ?? "Point",
    start: clamp(n.startNormalised * duration, 0, duration),
    end: clamp(n.endNormalised * duration, 0, duration),
  };
}

/* ── Reel time ─────────────────────────────────────────────────────────── */

/**
 * Source time → position in the exported reel, or null when `t` falls in a gap
 * and so never reaches the output.
 *
 * This is the same accumulation the exporter performs while joining ranges, so
 * the two must agree: a keyframe drawn at reel position X here is the frame the
 * render puts at X.
 */
export function sourceToReelTime(doc: ReframeDoc, t: number): number | null {
  let offset = 0;
  for (const seg of doc.segments) {
    if (t < seg.start) return null;
    if (t < seg.end) return offset + (t - seg.start);
    offset += seg.end - seg.start;
  }
  return null;
}

/**
 * As {@link sourceToReelTime}, but never null: a time in a gap resolves to the
 * cut it would be skipped to, and anything past the last segment to the end of
 * the reel. For the playhead, which can sit anywhere.
 */
export function sourceToReelTimeClamped(doc: ReframeDoc, t: number): number {
  let offset = 0;
  for (const seg of doc.segments) {
    if (t < seg.start) return offset;
    if (t < seg.end) return offset + (t - seg.start);
    offset += seg.end - seg.start;
  }
  return offset;
}

/** Reel position → source time, clamped to the reel's bounds. */
export function reelToSourceTime(doc: ReframeDoc, reelTime: number): number {
  if (doc.segments.length === 0) return clamp(reelTime, 0, doc.source.duration);
  let remaining = Math.max(0, reelTime);
  for (const seg of doc.segments) {
    const span = seg.end - seg.start;
    if (remaining < span) return seg.start + remaining;
    remaining -= span;
  }
  return doc.segments[doc.segments.length - 1].end;
}
