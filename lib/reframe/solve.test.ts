import assert from "node:assert/strict";
import { addSegment, createDoc, upsertKeyframe, type ReframeDoc } from "./model.ts";
import {
  clampCenter,
  cropExtent,
  maxCropExtent,
  solveCrop,
  solveState,
  cropTransform,
  keyframeRangeAt,
} from "./solve.ts";

const source = { width: 1920, height: 1080, duration: 10, name: "t.mp4", frameRate: 30 };
let doc: ReframeDoc = createDoc(source);

// 1. A 9:16 window in a 16:9 source is full height and 9/16 of it wide.
const max = maxCropExtent(doc);
assert.equal(max.height, 1080);
assert.equal(max.width, 1080 * (9 / 16));
console.log("✓ crop extent", max);

// 2. No keyframes → dead centre, full height.
const rect = solveCrop(doc, 0);
assert.equal(rect.x, 1920 / 2 - max.width / 2);
assert.equal(rect.y, 0);
console.log("✓ default centre", rect);

// 3. A tap near the left edge clamps to the edge, not past it.
const half = max.width / 1920 / 2;
assert.equal(clampCenter(doc, 0.0, 0.5, 1).cx, half);
assert.equal(clampCenter(doc, 1.0, 0.5, 1).cx, 1 - half);
assert.equal(clampCenter(doc, 0.5, 0.5, 1).cx, 0.5);
// Vertical is pinned at zoom 1 because the crop is already full height.
assert.equal(clampCenter(doc, 0.5, 0.1, 1).cy, 0.5);
console.log("✓ clamping", { half });

// 4. Keyframes interpolate, and easing shapes the curve.
doc = upsertKeyframe(doc, { t: 0, cx: 0.2, cy: 0.5, zoom: 1, easing: "linear" });
doc = upsertKeyframe(doc, { t: 4, cx: 0.8, cy: 0.5, zoom: 1 });
assert.equal(solveState(doc, 0).cx, 0.2);
assert.equal(solveState(doc, 4).cx, 0.8);
assert.ok(Math.abs(solveState(doc, 2).cx - 0.5) < 1e-9, "linear midpoint");
// Held outside the keyframe range.
assert.equal(solveState(doc, -1).cx, 0.2);
assert.equal(solveState(doc, 9).cx, 0.8);
console.log("✓ linear interpolation");

doc = upsertKeyframe(doc, { t: 0, cx: 0.2, cy: 0.5, zoom: 1, easing: "easeInOut" });
assert.ok(Math.abs(solveState(doc, 2).cx - 0.5) < 1e-9, "smoothstep is symmetric at midpoint");
assert.ok(solveState(doc, 1).cx < 0.35, "smoothstep starts slow");
assert.ok(solveState(doc, 3).cx > 0.65, "smoothstep ends slow");
console.log("✓ easeInOut interpolation");

doc = upsertKeyframe(doc, { t: 0, cx: 0.2, cy: 0.5, zoom: 1, easing: "hold" });
assert.equal(solveState(doc, 3.99).cx, 0.2);
assert.equal(solveState(doc, 4).cx, 0.8);
console.log("✓ hold");

// 5. Upsert at the same time replaces rather than stacks.
const before = doc.keyframes.length;
doc = upsertKeyframe(doc, { t: 4, cx: 0.6, cy: 0.5, zoom: 1 });
assert.equal(doc.keyframes.length, before);
assert.equal(doc.keyframes.at(-1)!.cx, 0.6);
console.log("✓ upsert replaces at same time");

// 6. Zoom shrinks the crop and widens the legal centre range.
assert.equal(cropExtent(doc, 2).width, max.width / 2);
assert.ok(clampCenter(doc, 0.05, 0.5, 2).cx < half, "zoomed-in crop can sit closer to the edge");
assert.ok(clampCenter(doc, 0.5, 0.2, 2).cy < 0.5, "zoom frees up vertical movement");
console.log("✓ zoom");

// 7. Clamping is applied after interpolation, so an animated crop never leaves
//    the frame even when the endpoints were legal at their own zoom levels.
let z: ReframeDoc = createDoc(source);
z = upsertKeyframe(z, { t: 0, cx: 0.06, cy: 0.5, zoom: 3, easing: "linear" });
z = upsertKeyframe(z, { t: 2, cx: 0.94, cy: 0.5, zoom: 3 });
for (let t = 0; t <= 2; t += 0.05) {
  const r = solveCrop(z, t);
  assert.ok(r.x >= -1e-9, `left edge at t=${t.toFixed(2)}: ${r.x}`);
  assert.ok(r.x + r.width <= 1920 + 1e-9, `right edge at t=${t.toFixed(2)}`);
  assert.ok(r.y >= -1e-9 && r.y + r.height <= 1080 + 1e-9, `vertical at t=${t.toFixed(2)}`);
}
console.log("✓ crop stays inside the source across an animated zoom");

// 8. The export transform maps the crop rect exactly onto the output canvas.
//    Regression: an export that ignores the crop rect silently produces the
//    whole frame squeezed into the target aspect, which looks "9:16 but wrong"
//    rather than failing loudly.
const target = { width: 1080, height: 1920 };
const c = solveCrop(doc, 4);
const tf = cropTransform(c, target);
const apply = (px: number, py: number) => ({
  x: px * tf.scaleX + tf.translateX,
  y: py * tf.scaleY + tf.translateY,
});
const topLeft = apply(c.x, c.y);
const bottomRight = apply(c.x + c.width, c.y + c.height);
assert.ok(Math.abs(topLeft.x) < 1e-9 && Math.abs(topLeft.y) < 1e-9, "crop origin → canvas origin");
assert.ok(
  Math.abs(bottomRight.x - target.width) < 1e-9 &&
    Math.abs(bottomRight.y - target.height) < 1e-9,
  "crop far corner → canvas far corner",
);
// The frame outside the crop must land outside the canvas, i.e. be clipped —
// if it fitted inside, the whole frame would be visible and squeezed.
const sourceFarCorner = apply(source.width, source.height);
assert.ok(sourceFarCorner.x > target.width + 1, "source extends past the canvas horizontally");
console.log("✓ export crop transform", { topLeft, bottomRight });

// 9. Segment-scoped solving: a pan must not interpolate across a cut.
//    Segments [0,4) and [6,10); keyframes at t=0, t=3 (inside the first) and
//    t=7 (inside the second).
let seg: ReframeDoc = createDoc(source);
seg = addSegment(seg, 0, 4).doc;
seg = addSegment(seg, 6, 10).doc;
seg = upsertKeyframe(seg, { t: 0, cx: 0.2, cy: 0.5, zoom: 1, easing: "linear" });
seg = upsertKeyframe(seg, { t: 3, cx: 0.8, cy: 0.5, zoom: 1, easing: "linear" });
seg = upsertKeyframe(seg, { t: 7, cx: 0.1, cy: 0.5, zoom: 1, easing: "linear" });

// Inside the first segment, its own two keyframes interpolate normally...
assert.ok(Math.abs(solveState(seg, 2).cx - 0.6) < 1e-9, "scoped interpolation still works");
// ...and past its last keyframe the framing HOLDS, rather than drifting toward
// the t=7 keyframe that belongs to a different point. Without scoping this
// would read ~0.64.
assert.equal(solveState(seg, 3.9).cx, 0.8, "held at the segment's last keyframe");
// The second segment starts exactly on its own first keyframe, not mid-pan.
assert.equal(solveState(seg, 6).cx, 0.1, "snapped to the segment's first keyframe");
// A gap holds the framing of the segment being LEFT, rather than interpolating
// toward the next one. Regression: a play-segments-only skip sets currentTime
// asynchronously, so the playhead sits in the gap for a frame or two while the
// picture is still the outgoing segment's last frame. Interpolating there made
// the crop jump onto the incoming segment's framing one frame before the cut.
assert.equal(solveState(seg, 4.5).cx, 0.8, "gap holds the outgoing segment");
// 5.9 rather than 5.99: within half a frame of a segment start the fuzzy
// membership already counts as that segment, which is intended.
assert.equal(solveState(seg, 5.9).cx, 0.8, "still held right up to the next cut");
// ...and before the first segment, the first segment's framing is held.
assert.equal(solveState(seg, -1).cx, 0.2);
console.log("✓ keyframes do not interpolate across a cut");

// 10. A keyframe sitting exactly on a segment boundary belongs to it — the
//     frame you press Out on must count as inside.
let edge: ReframeDoc = createDoc(source);
edge = addSegment(edge, 0, 4).doc;
edge = upsertKeyframe(edge, { t: 0, cx: 0.2, cy: 0.5, zoom: 1, easing: "linear" });
edge = upsertKeyframe(edge, { t: 4, cx: 0.6, cy: 0.5, zoom: 1, easing: "linear" });
assert.equal(keyframeRangeAt(edge, 2).hi, 2, "the boundary keyframe is in scope");
assert.ok(Math.abs(solveState(edge, 2).cx - 0.4) < 1e-9);
console.log("✓ boundary keyframe belongs to the segment");

// 11. A segment with no keyframes of its own keeps the surrounding framing
//     instead of snapping to dead centre.
let unframed: ReframeDoc = createDoc(source);
unframed = addSegment(unframed, 4.5, 5.5).doc;
unframed = upsertKeyframe(unframed, { t: 3, cx: 0.8, cy: 0.5, zoom: 1, easing: "linear" });
unframed = upsertKeyframe(unframed, { t: 7, cx: 0.1, cy: 0.5, zoom: 1, easing: "linear" });
assert.deepEqual(keyframeRangeAt(unframed, 5), { lo: 0, hi: 2 }, "falls back to every keyframe");
assert.ok(Math.abs(solveState(unframed, 5).cx - 0.45) < 1e-9);
console.log("✓ an unframed segment inherits the surrounding framing");

// 12. A keyframe placed in a gap still governs the crop there. Regression:
//     scoping a gap to the previous segment's keyframes alone meant clicking
//     the video anywhere unmarked created a keyframe that was then ignored —
//     the frame simply didn't move. It only showed up once the preceding
//     segment already had keyframes of its own, which is why it was
//     intermittent.
let gapKf: ReframeDoc = createDoc(source);
gapKf = addSegment(gapKf, 0, 4).doc;
gapKf = addSegment(gapKf, 8, 10).doc;
gapKf = upsertKeyframe(gapKf, { t: 1, cx: 0.2, cy: 0.5, zoom: 1, easing: "linear" });
gapKf = upsertKeyframe(gapKf, { t: 9, cx: 0.9, cy: 0.5, zoom: 1, easing: "linear" });
// Nothing in the gap yet: the outgoing segment's framing is held across it.
assert.equal(solveState(gapKf, 6).cx, 0.2, "gap holds the segment before it");
// Now click to reframe at 6. It must take effect immediately.
gapKf = upsertKeyframe(gapKf, { t: 6, cx: 0.55, cy: 0.5, zoom: 1, easing: "linear" });
assert.equal(solveState(gapKf, 6).cx, 0.55, "a keyframe in a gap governs its own time");
// ...and it must not leak into the next segment, which still snaps to its own.
assert.equal(solveState(gapKf, 8).cx, 0.9, "the next segment is unaffected");
// The cut out of the first segment is still stable: at 4.001 the crop is
// between segment one's keyframe and the gap one, never the next segment's.
assert.ok(solveState(gapKf, 4.001).cx < 0.3, "no jump toward the incoming segment");
console.log("✓ keyframes placed in a gap still work");

console.log("\nAll solver checks passed.");

/* ── cropTexMatrix: crop + rotation in texture coordinates ─────────────── */
import { cropTexMatrix, type SourceRotation } from "./solve.ts";

// Apply the column-major mat3 to a normalised output point.
const applyTex = (
  m: ReturnType<typeof cropTexMatrix>,
  px: number,
  py: number,
): [number, number] => [
  m[0] * px + m[3] * py + m[6],
  m[1] * px + m[4] * py + m[7],
];

// A distinctive crop inside a 1920×1080 display frame.
const texCrop = { x: 192, y: 108, width: 384, height: 683 };
const disp = { width: 1920, height: 1080 };
// Display-space corners of that crop, normalised.
const dTL = [192 / 1920, 108 / 1080];
const dBR = [(192 + 384) / 1920, (108 + 683) / 1080];

// rotation 0: texture coords are display coords.
{
  const m = cropTexMatrix(texCrop, disp, 0);
  const [u0, v0] = applyTex(m, 0, 0);
  const [u1, v1] = applyTex(m, 1, 1);
  assert.ok(Math.abs(u0 - dTL[0]) < 1e-12 && Math.abs(v0 - dTL[1]) < 1e-12);
  assert.ok(Math.abs(u1 - dBR[0]) < 1e-12 && Math.abs(v1 - dBR[1]) < 1e-12);
}
// The four rotations follow the display→texture inverse of a clockwise
// rotation: 90 → (d.y, 1−d.x), 180 → (1−d.x, 1−d.y), 270 → (1−d.y, d.x).
const expectTex = (rot: SourceRotation, d: number[]): number[] => {
  switch (rot) {
    case 0: return [d[0], d[1]];
    case 90: return [d[1], 1 - d[0]];
    case 180: return [1 - d[0], 1 - d[1]];
    case 270: return [1 - d[1], d[0]];
  }
};
for (const rot of [0, 90, 180, 270] as const) {
  const m = cropTexMatrix(texCrop, disp, rot);
  for (const [px, py, d] of [
    [0, 0, dTL],
    [1, 1, dBR],
    [1, 0, [dBR[0], dTL[1]]],
    [0, 1, [dTL[0], dBR[1]]],
  ] as const) {
    const [u, v] = applyTex(m, px, py);
    const [eu, ev] = expectTex(rot, d as number[]);
    assert.ok(
      Math.abs(u - eu) < 1e-12 && Math.abs(v - ev) < 1e-12,
      `rotation ${rot} corner (${px},${py}): got (${u},${v}) want (${eu},${ev})`,
    );
  }
  // A full-frame crop must cover the whole texture for every rotation.
  const full = cropTexMatrix({ x: 0, y: 0, ...disp }, disp, rot);
  const corners = [applyTex(full, 0, 0), applyTex(full, 1, 0), applyTex(full, 0, 1), applyTex(full, 1, 1)];
  const us = corners.map((c) => c[0]).sort((a, b) => a - b);
  const vs = corners.map((c) => c[1]).sort((a, b) => a - b);
  assert.ok(us[0] === 0 && us[3] === 1 && vs[0] === 0 && vs[3] === 1, `full frame at ${rot}`);
}
console.log("✓ cropTexMatrix rotations");

console.log("All texture-matrix checks passed.");

/* ── Target shapes: 9:16, 1:1 and 16:9 ─────────────────────────────────── */
import { TARGET_ASPECTS, TARGET_PRESETS, findTargetPreset, DEFAULT_TARGET } from "./model.ts";

{
  const src = { width: 1920, height: 1080, duration: 10, name: "t.mp4", frameRate: 30 };

  // 16:9 out of a 16:9 source is the whole frame — no crop at all. This is
  // what makes the editor usable as a plain trimmer, so it must stay exact.
  const wide = solveCrop(createDoc(src, { width: 1920, height: 1080 }), 0);
  assert.deepEqual(wide, { x: 0, y: 0, width: 1920, height: 1080 }, "16:9 is the full frame");
  // ...and it holds at every listed 16:9 resolution, since only the ratio matters.
  for (const size of TARGET_PRESETS["16:9"]) {
    const r = solveCrop(createDoc(src, size), 0);
    assert.deepEqual(r, { x: 0, y: 0, width: 1920, height: 1080 }, `full frame at ${size.width}`);
  }

  // 1:1 is a centred, full-height square.
  const square = solveCrop(createDoc(src, { width: 1080, height: 1080 }), 0);
  assert.deepEqual(square, { x: 420, y: 0, width: 1080, height: 1080 }, "1:1 centred square");

  // A vertical source flips which dimension is the constrained one: a 16:9
  // target out of 9:16 footage is full width, not full height.
  const vertical = { ...src, width: 1080, height: 1920 };
  const wideFromTall = solveCrop(createDoc(vertical, { width: 1920, height: 1080 }), 0);
  assert.equal(wideFromTall.width, 1080, "16:9 from a vertical source is full width");
  assert.equal(wideFromTall.height, 1080 * (9 / 16));
  assert.equal(wideFromTall.y, (1920 - wideFromTall.height) / 2, "and vertically centred");

  // With no keyframes every shape is centred, which is what lets an export
  // run before anything has been framed. Iterating TARGET_ASPECTS rather than
  // a hand-written list means a newly added shape is covered by default.
  for (const aspect of TARGET_ASPECTS) {
    for (const size of TARGET_PRESETS[aspect]) {
      const doc = createDoc(src, size);
      const r = solveCrop(doc, 0);
      assert.ok(
        Math.abs(r.x + r.width / 2 - src.width / 2) < 1e-9,
        `${aspect} ${size.width}×${size.height} centred horizontally`,
      );
      assert.ok(r.width <= src.width + 1e-9 && r.height <= src.height + 1e-9, "fits the source");
    }
  }
  console.log("✓ target shapes");
}

// Preset lookup, which drives the two export selects.
{
  assert.deepEqual(findTargetPreset({ width: 1920, height: 1080 }), { aspect: "16:9", index: 1 });
  assert.deepEqual(findTargetPreset(DEFAULT_TARGET), { aspect: "9:16", index: 1 });
  assert.equal(findTargetPreset({ width: 999, height: 111 }), null, "custom sizes stay valid");
  // Index alignment is what makes "switch shape, keep the tier" work, so
  // every aspect must offer the same number of tiers.
  for (const aspect of TARGET_ASPECTS) {
    assert.equal(
      TARGET_PRESETS[aspect].length,
      TARGET_PRESETS["9:16"].length,
      `${aspect} has the same number of tiers`,
    );
    for (let i = 0; i < TARGET_PRESETS[aspect].length; i++) {
      assert.equal(findTargetPreset(TARGET_PRESETS[aspect][i])?.index, i, `${aspect} tier ${i}`);
    }
  }
  for (const aspect of TARGET_ASPECTS) {
    const [w, h] = aspect.split(":").map(Number);
    let previous = 0;
    for (const size of TARGET_PRESETS[aspect]) {
      // Every preset must actually have the ratio its key claims — a typo
      // like 1080×1340 would otherwise sail through and quietly crop wrong.
      assert.ok(
        Math.abs(size.width / size.height - w / h) < 1e-9,
        `${aspect} ${size.width}×${size.height} matches its ratio`,
      );
      // The picker shows these in array order, so the array is the sort.
      const smaller = Math.min(size.width, size.height);
      assert.ok(smaller > previous, `${aspect} tiers ascend (${smaller} after ${previous})`);
      previous = smaller;
      // H.264 4:2:0 cannot encode odd dimensions.
      assert.ok(size.width % 2 === 0 && size.height % 2 === 0, `${aspect} ${smaller} is even`);
    }
  }
  console.log("✓ target presets");
}

console.log("All target-shape checks passed.");

/* ── Keyframes store intent, not the clamped result ────────────────────── */
{
  const src = { width: 1920, height: 1080, duration: 10, name: "t.mp4", frameRate: 30 };
  const wide = { width: 1920, height: 1080 };
  const tall = { width: 1080, height: 1920 };
  const square = { width: 1080, height: 1080 };
  // Half the crop width, normalised — how close a centre may get to an edge.
  const halfOf = (target: { width: number; height: number }) =>
    maxCropExtent(createDoc(src, target)).width / src.width / 2;

  const withKeys = (
    target: { width: number; height: number },
    keys: Array<{ t: number; cx: number; cy?: number }>,
  ) => {
    let d = createDoc(src, target);
    for (const k of keys) {
      d = upsertKeyframe(d, { t: k.t, cx: k.cx, cy: k.cy ?? 0.5, zoom: 1, easing: "linear" });
    }
    return d;
  };
  const centreX = (d: ReframeDoc, t: number) => {
    const r = solveCrop(d, t);
    return (r.x + r.width / 2) / src.width;
  };

  // The headline case. Framing at 16:9 out of 16:9 footage moves nothing —
  // there is no freedom — but the clicks are still recorded, so switching to
  // 9:16 afterwards pans between them instead of sitting dead centre.
  const clicks = [
    { t: 0, cx: 0.2 },
    { t: 5, cx: 0.8 },
  ];
  const asWide = withKeys(wide, clicks);
  assert.deepEqual(solveCrop(asWide, 0), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(solveCrop(asWide, 5), { x: 0, y: 0, width: 1920, height: 1080 });
  const asTall = { ...asWide, target: tall };
  assert.ok(Math.abs(centreX(asTall, 0) - 0.2) < 1e-9, "9:16 recovers the first click");
  assert.ok(Math.abs(centreX(asTall, 5) - 0.8) < 1e-9, "9:16 recovers the second click");
  console.log("✓ intent survives a 16:9 → 9:16 switch");

  // A click the shape cannot reach is still recorded in full, and each shape
  // clamps it to its own limit — so the framing opens up as freedom grows.
  const edge = withKeys(tall, [{ t: 0, cx: 0.05 }]);
  assert.ok(Math.abs(centreX(edge, 0) - halfOf(tall)) < 1e-9, "9:16 pins to its own edge");
  const edgeSquare = { ...edge, target: square };
  assert.ok(Math.abs(centreX(edgeSquare, 0) - halfOf(square)) < 1e-9, "1:1 pins to its own edge");
  assert.ok(halfOf(square) > halfOf(tall), "the square window is the wider one");
  // The stored keyframe itself was never rewritten by either shape.
  assert.equal(edge.keyframes[0].cx, 0.05, "the click is stored as clicked");
  console.log("✓ intent adapts per shape");

  // Pan feel: with an unreachable start the pan must set off immediately,
  // because each endpoint is pulled into range *before* interpolating. (Were
  // the raw values interpolated instead, the crop would sit at the edge for
  // the first ~17% of the move.)
  const pan = withKeys(tall, [
    { t: 0, cx: 0.0 },
    { t: 10, cx: 0.9 },
  ]);
  const atStart = centreX(pan, 0);
  assert.ok(Math.abs(atStart - halfOf(tall)) < 1e-9, "starts pinned to the edge");
  assert.ok(centreX(pan, 1) > atStart + 1e-6, "and is already moving one second in");
  // Linear easing between two clamped endpoints is a straight line. Both ends
  // are out of reach here (0.9 is past 1 − half too), so the midpoint is the
  // average of the two edge limits — dead centre.
  const mid = (halfOf(tall) + (1 - halfOf(tall))) / 2;
  assert.ok(Math.abs(mid - 0.5) < 1e-12);
  assert.ok(Math.abs(centreX(pan, 5) - mid) < 1e-9, "midpoint is the clamped average");
  console.log("✓ pan sets off immediately from a clamped edge");

  // Idempotence: feeding back the already-clamped centres (what documents
  // written before this change contain) renders identically.
  const clamped = withKeys(tall, [{ t: 0, cx: halfOf(tall) }]);
  assert.deepEqual(solveCrop(clamped, 0), solveCrop(edge, 0), "old documents are unchanged");
  console.log("✓ pre-existing documents render identically");

  // Both axes behave the same way: at zoom 1 a 9:16 window is full height, so
  // a vertical click is recorded but unreachable until zoomed in.
  let vertical = createDoc(src, tall);
  vertical = upsertKeyframe(vertical, { t: 0, cx: 0.5, cy: 0.1, zoom: 1, easing: "linear" });
  assert.equal(solveCrop(vertical, 0).y, 0, "no vertical freedom at zoom 1");
  const zoomed = { ...vertical, keyframes: [{ ...vertical.keyframes[0], zoom: 2 }] };
  assert.ok(solveCrop(zoomed, 0).y < 1080 / 2 - solveCrop(zoomed, 0).height / 2 + 1e-9);
  assert.ok(solveCrop(zoomed, 0).y >= 0, "and it stays inside the frame");
  console.log("✓ vertical intent behaves the same");
}

console.log("All intent-keyframe checks passed.");
