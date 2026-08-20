import assert from "node:assert/strict";
import { createDoc, upsertKeyframe, type ReframeDoc } from "./model.ts";
import {
  clampCenter,
  cropExtent,
  maxCropExtent,
  solveCrop,
  solveState,
  cropTransform,
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

console.log("\nAll solver checks passed.");
