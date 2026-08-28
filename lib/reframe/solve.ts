/**
 * Reframe solver — turns a {@link ReframeDoc} plus a time into a crop rect.
 *
 * Like model.ts this is pure, dependency-free arithmetic so that the Swift
 * and web implementations can be checked against each other frame for frame.
 * Every consumer (stage overlay, live preview, exporter) goes through
 * {@link solveCrop} so there is exactly one definition of where the frame is.
 */

import {
  clamp,
  keyframeEpsilon,
  type ReframeDoc,
  type ReframeKeyframe,
  type ReframeSegment,
} from "./model.ts";

/** A crop window in source pixels, ready for `drawImage`'s source args. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The un-clamped, un-positioned crop values at a point in time. */
export interface CropState {
  cx: number;
  cy: number;
  zoom: number;
}

/**
 * The largest rect of the target's aspect ratio that fits inside the source.
 * For a 16:9 source and a 9:16 target this is full-height and 31.6% as wide;
 * for a target *wider* than the source it is full-width instead.
 */
export function maxCropExtent(doc: ReframeDoc): { width: number; height: number } {
  const { width: sw, height: sh } = doc.source;
  const targetAspect = doc.target.width / doc.target.height;
  const width = Math.min(sw, sh * targetAspect);
  return { width, height: width / targetAspect };
}

/** The crop extent in source pixels at a given zoom (zoom 1 = {@link maxCropExtent}). */
export function cropExtent(doc: ReframeDoc, zoom: number): { width: number; height: number } {
  const max = maxCropExtent(doc);
  const z = Math.max(1, zoom);
  return { width: max.width / z, height: max.height / z };
}

/**
 * Pull a centre back inside the source frame.
 *
 * This is the "unless that would push the frame off the edge, in which case
 * stop at the edge" rule. When the crop is as wide as the source there is no
 * freedom left and the centre is pinned to the middle.
 */
export function clampCenter(
  doc: ReframeDoc,
  cx: number,
  cy: number,
  zoom: number,
): { cx: number; cy: number } {
  const { width, height } = cropExtent(doc, zoom);
  const halfW = width / doc.source.width / 2;
  const halfH = height / doc.source.height / 2;
  return {
    cx: halfW >= 0.5 ? 0.5 : clamp(cx, halfW, 1 - halfW),
    cy: halfH >= 0.5 ? 0.5 : clamp(cy, halfH, 1 - halfH),
  };
}

function ease(easing: ReframeKeyframe["easing"], u: number): number {
  switch (easing) {
    case "hold":
      return 0;
    case "linear":
      return u;
    case "easeInOut":
      // Smoothstep: zero velocity at both ends, so the pan settles on each
      // keyframe instead of cornering through it.
      return u * u * (3 - 2 * u);
  }
}

/**
 * The half-open index window of `doc.keyframes` that governs time `t`.
 *
 * With no segments — or with `t` outside every segment — this is the whole
 * array, i.e. exactly the behaviour from before segments existed. Inside a
 * segment it is that segment's own keyframes, so a pan can't interpolate
 * across a cut: each point in the reel is framed independently.
 *
 * Membership here is fuzzy by half a frame at both ends, unlike the strictly
 * half-open `segmentAt` used for playback. A keyframe placed on the very frame
 * you pressed Out on must belong to that segment, and a keyframe sitting on a
 * shared boundary should hold the framing on both sides of the cut.
 */
export function keyframeRangeAt(doc: ReframeDoc, t: number): { lo: number; hi: number } {
  const all = { lo: 0, hi: doc.keyframes.length };
  if (doc.segments.length === 0) return all;

  const eps = keyframeEpsilon(doc);
  const firstAtOrAfter = (time: number) => {
    let i = 0;
    while (i < doc.keyframes.length && doc.keyframes[i].t < time) i += 1;
    return i;
  };

  const seg = doc.segments.find((s) => t >= s.start - eps && t <= s.end + eps);
  if (seg) {
    const lo = firstAtOrAfter(seg.start - eps);
    let hi = lo;
    while (hi < doc.keyframes.length && doc.keyframes[hi].t <= seg.end + eps) hi += 1;
    // A segment you haven't framed yet keeps the surrounding framing rather
    // than snapping to dead centre.
    return hi > lo ? { lo, hi } : all;
  }

  // In a gap, which belongs to the segment *before* it. The range therefore
  // runs from that segment's start up to (but not into) the next segment.
  //
  // Two things depend on this. Frames here never reach the export, but the
  // live preview still solves them: a play-segments-only skip sets
  // currentTime asynchronously, so for a frame or two the playhead sits past
  // the outgoing segment while the picture is still its last frame — and
  // reaching into the *next* segment's keyframes there makes the crop jump one
  // frame before the cut. Equally, a keyframe dropped in the gap has to count,
  // or clicking the video somewhere unmarked would silently do nothing.
  const previous = segmentBefore(doc, t);
  const next = doc.segments.find((s) => s.start > t);
  const lo = previous ? firstAtOrAfter(previous.start - eps) : 0;
  const hi = next ? firstAtOrAfter(next.start - eps) : doc.keyframes.length;
  return hi > lo ? { lo, hi } : all;
}

/** The last segment that ends at or before `t`. Segments are sorted. */
function segmentBefore(doc: ReframeDoc, t: number): ReframeSegment | null {
  let found: ReframeSegment | null = null;
  for (const seg of doc.segments) {
    if (seg.end > t) break;
    found = seg;
  }
  return found;
}

/** The centre a keyframe contributes to an interpolation. */
type CentreOf = (kf: ReframeKeyframe) => { cx: number; cy: number };

const storedCentre: CentreOf = (kf) => kf;

/**
 * The interpolation walk, shared by the raw and reachable solves. Which
 * keyframes take part, the hold-outside-the-range rule and the easing are
 * identical either way; only the centre each keyframe contributes differs.
 */
function interpolateState(doc: ReframeDoc, t: number, centreOf: CentreOf): CropState {
  const kfs = doc.keyframes;
  const { lo, hi } = keyframeRangeAt(doc, t);
  if (hi <= lo) return { cx: 0.5, cy: 0.5, zoom: 1 };

  const first = kfs[lo];
  if (t <= first.t) return { ...centreOf(first), zoom: first.zoom };

  const last = kfs[hi - 1];
  if (t >= last.t) return { ...centreOf(last), zoom: last.zoom };

  let i = lo;
  while (i < hi - 1 && kfs[i + 1].t <= t) i += 1;
  const a = kfs[i];
  const b = kfs[i + 1];

  const span = b.t - a.t;
  const u = span > 0 ? clamp((t - a.t) / span, 0, 1) : 0;
  const e = ease(a.easing, u);
  const ca = centreOf(a);
  const cb = centreOf(b);

  return {
    cx: ca.cx + (cb.cx - ca.cx) * e,
    cy: ca.cy + (cb.cy - ca.cy) * e,
    zoom: a.zoom + (b.zoom - a.zoom) * e,
  };
}

/**
 * Interpolate the *intended* crop state at time `t` — the points that were
 * pointed at, with no regard for whether the frame can actually reach them.
 *
 * This is what the editor authors keyframes from, so that intent survives a
 * change of target shape. For where the crop actually lands, use
 * {@link solveCrop}.
 *
 * Outside the governing keyframe range the nearest keyframe is held, so a
 * single keyframe means a static crop and no keyframes means dead centre.
 */
export function solveState(doc: ReframeDoc, t: number): CropState {
  return interpolateState(doc, t, storedCentre);
}

/**
 * The crop rect at time `t`, in source pixels.
 *
 * Clamping happens twice, and both are load-bearing:
 *
 * - **Per keyframe, before interpolating.** A keyframe records where you
 *   pointed, which may be somewhere this target shape cannot reach. Pulling
 *   each endpoint into range first means the pan runs between positions that
 *   exist, so it sets off immediately instead of sitting at the edge while the
 *   interpolation catches up. It is also what makes rendering unchanged for a
 *   document authored under this same shape: those centres are already in
 *   range, so this is a no-op on them.
 * - **On the result.** When `zoom` animates, a centre that is legal at both
 *   ends of a segment can still leave the frame in the middle of it.
 */
export function solveCrop(doc: ReframeDoc, t: number): CropRect {
  const state = interpolateState(doc, t, (kf) => clampCenter(doc, kf.cx, kf.cy, kf.zoom));
  const { width, height } = cropExtent(doc, state.zoom);
  const { cx, cy } = clampCenter(doc, state.cx, state.cy, state.zoom);
  return {
    x: cx * doc.source.width - width / 2,
    y: cy * doc.source.height - height / 2,
    width,
    height,
  };
}

/**
 * The affine transform that maps a crop rect onto a target-sized surface,
 * as `[scaleX, 0, 0, scaleY, translateX, translateY]` — the argument order
 * `CanvasRenderingContext2D.setTransform` takes.
 *
 * Kept here, next to the crop math and free of any canvas dependency, so the
 * exporter's geometry is testable in isolation and can't drift from the
 * solver. The Swift port needs the same matrix; see docs/reframe-format.md.
 */
export function cropTransform(
  crop: CropRect,
  target: { width: number; height: number },
): { scaleX: number; scaleY: number; translateX: number; translateY: number } {
  const scaleX = target.width / crop.width;
  const scaleY = target.height / crop.height;
  return { scaleX, scaleY, translateX: -crop.x * scaleX, translateY: -crop.y * scaleY };
}

/** Rotation metadata in degrees clockwise, as containers (and mediabunny) express it. */
export type SourceRotation = 0 | 90 | 180 | 270;

/**
 * The column-major 3×3 matrix mapping a normalised output position to a
 * texture coordinate, for the WebGL export path: `(u, v, 1)ᵀ = M · (px, py, 1)ᵀ`
 * with both spaces in [0,1]², origin top-left, y down.
 *
 * `crop` is in *display* space (post-rotation, the space {@link solveCrop}
 * works in, rescaled to the decoded sample), while the uploaded texture holds
 * the *pre-rotation* frame — so the matrix folds the rotation in. Rotation is
 * not a special case on purpose: iPhone HLG footage is exactly what carries
 * rotation metadata.
 *
 * Kept here, next to {@link cropTransform}, dependency-free and unit-tested
 * for all four rotations before any GL touches it.
 */
export function cropTexMatrix(
  crop: CropRect,
  display: { width: number; height: number },
  rotation: SourceRotation,
): [number, number, number, number, number, number, number, number, number] {
  // d = ((crop.x + px·crop.w) / display.w, (crop.y + py·crop.h) / display.h)
  // is the display-space point; the rotation cases then map display → texture:
  //   0:   u = d.x       v = d.y
  //   90:  u = d.y       v = 1 − d.x
  //   180: u = 1 − d.x   v = 1 − d.y
  //   270: u = 1 − d.y   v = d.x
  const X = crop.x / display.width;
  const W = crop.width / display.width;
  const Y = crop.y / display.height;
  const H = crop.height / display.height;

  // Rows of M as [du/dpx, du/dpy, u0] and [dv/dpx, dv/dpy, v0].
  let u: [number, number, number];
  let v: [number, number, number];
  switch (rotation) {
    case 0:
      u = [W, 0, X];
      v = [0, H, Y];
      break;
    case 90:
      u = [0, H, Y];
      v = [-W, 0, 1 - X];
      break;
    case 180:
      u = [-W, 0, 1 - X];
      v = [0, -H, 1 - Y];
      break;
    case 270:
      u = [0, -H, 1 - Y];
      v = [W, 0, X];
      break;
  }
  // Column-major, the layout `uniformMatrix3fv` expects.
  return [u[0], v[0], 0, u[1], v[1], 0, u[2], v[2], 1];
}

/** The crop at time `t` expressed in 0–1 source coordinates, for CSS overlays. */
export function solveCropNormalised(doc: ReframeDoc, t: number): CropRect {
  const rect = solveCrop(doc, t);
  return {
    x: rect.x / doc.source.width,
    y: rect.y / doc.source.height,
    width: rect.width / doc.source.width,
    height: rect.height / doc.source.height,
  };
}
