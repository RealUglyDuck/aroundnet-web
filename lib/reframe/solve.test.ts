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
