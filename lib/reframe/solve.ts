/**
 * Reframe solver — turns a {@link ReframeDoc} plus a time into a crop rect.
 *
 * Like model.ts this is pure, dependency-free arithmetic so that the Swift
 * and web implementations can be checked against each other frame for frame.
 * Every consumer (stage overlay, live preview, exporter) goes through
 * {@link solveCrop} so there is exactly one definition of where the frame is.
 */

import { clamp, type ReframeDoc, type ReframeKeyframe } from "./model.ts";

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
 * Interpolate the raw (un-clamped) crop state at time `t`.
 *
 * Outside the keyframe range the nearest keyframe is held, so a single
 * keyframe means a static crop for the whole video and no keyframes means
 * dead centre.
 */
export function solveState(doc: ReframeDoc, t: number): CropState {
  const kfs = doc.keyframes;
  if (kfs.length === 0) return { cx: 0.5, cy: 0.5, zoom: 1 };

  const first = kfs[0];
  if (t <= first.t) return { cx: first.cx, cy: first.cy, zoom: first.zoom };

  const last = kfs[kfs.length - 1];
  if (t >= last.t) return { cx: last.cx, cy: last.cy, zoom: last.zoom };

  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1].t <= t) i += 1;
  const a = kfs[i];
  const b = kfs[i + 1];

  const span = b.t - a.t;
  const u = span > 0 ? clamp((t - a.t) / span, 0, 1) : 0;
  const e = ease(a.easing, u);

  return {
    cx: a.cx + (b.cx - a.cx) * e,
    cy: a.cy + (b.cy - a.cy) * e,
    zoom: a.zoom + (b.zoom - a.zoom) * e,
  };
}

/**
 * The crop rect at time `t`, in source pixels.
 *
 * Clamping happens *after* interpolation as well as at edit time: when zoom
 * animates, a centre that was legal at both ends of a segment can still leave
 * the frame in the middle of it.
 */
export function solveCrop(doc: ReframeDoc, t: number): CropRect {
  const state = solveState(doc, t);
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
