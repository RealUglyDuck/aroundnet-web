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
}

export interface ReframeDoc {
  version: 1;
  source: ReframeSource;
  /** Output pixel dimensions. Its aspect ratio drives the crop shape. */
  target: { width: number; height: number };
  /** Sorted ascending by `t`. Use the helpers below to preserve that. */
  keyframes: ReframeKeyframe[];
}

export const TARGET_PRESETS = {
  "1080x1920": { width: 1080, height: 1920 },
  "720x1280": { width: 720, height: 1280 },
  "1440x2560": { width: 1440, height: 2560 },
} as const;

export type TargetPresetKey = keyof typeof TARGET_PRESETS;

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
  target: { width: number; height: number } = TARGET_PRESETS["1080x1920"],
): ReframeDoc {
  return { version: 1, source, target, keyframes: [] };
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
  return {
    version: 1,
    source: { ...d.source, name: d.source.name ?? "video" },
    target: { width: d.target.width, height: d.target.height },
    keyframes,
  };
}
