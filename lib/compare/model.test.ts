import assert from "node:assert/strict";
import {
  DEFAULT_VIEW,
  EMPTY_DOC,
  MAX_ZOOM,
  bothLoaded,
  clearOffset,
  clipDuration,
  createClip,
  frameDuration,
  frameStepU,
  longerSide,
  masterDuration,
  clampView,
  paneFit,
  parseDoc,
  replaceSource,
  serializeDoc,
  masterToU,
  nudgeOffset,
  panBy,
  otherSide,
  referenceClip,
  resetMarks,
  sampleTime,
  setClip,
  setEnd,
  setReference,
  setStart,
  timeToU,
  uToMaster,
  viewTransform,
  zoomAt,
  type CompareDoc,
} from "./model.ts";
import { nudgeRate } from "../video/rates.ts";

/** Two serves of different length and, deliberately, different frame rates. */
const sourceA = { width: 1920, height: 1080, duration: 30, name: "mine.mp4", frameRate: 30 };
const sourceB = { width: 1080, height: 1920, duration: 20, name: "pro.mp4", frameRate: 60 };

const loaded: CompareDoc = setClip(
  setClip(EMPTY_DOC, "a", createClip(sourceA)),
  "b",
  createClip(sourceB),
);

/** The serve ranges used by most of the cases below: 1.20s vs 0.95s. */
function marked(): CompareDoc {
  let doc = setEnd(setStart(loaded, "a", 10), "a", 11.2);
  doc = setEnd(setStart(doc, "b", 5), "b", 5.95);
  return doc;
}
const near = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ""} — ${a} vs ${b}`);

// 1. A dropped clip is marked as its whole self; there is no "unmarked" state.
const fresh = createClip(sourceA);
assert.equal(fresh.start, 0);
assert.equal(fresh.end, 30);
assert.equal(fresh.offset, 0);
assert.equal(bothLoaded(EMPTY_DOC), false);
assert.equal(bothLoaded(loaded), true);
assert.equal(otherSide("a"), "b");
console.log("✓ a fresh clip is its own whole range");

// 2. Normalised sync: the endpoints line up exactly despite unequal durations.
{
  const doc = marked();
  near(clipDuration(doc.a!), 1.2, "range A");
  near(clipDuration(doc.b!), 0.95, "range B");

  near(sampleTime(doc.a!, 0), 10, "A at u=0");
  near(sampleTime(doc.b!, 0), 5, "B at u=0");
  near(sampleTime(doc.a!, 1), 11.2, "A at u=1");
  near(sampleTime(doc.b!, 1), 5.95, "B at u=1");

  // Halfway through the motion is halfway through both, not the same offset.
  near(sampleTime(doc.a!, 0.5), 10.6);
  near(sampleTime(doc.b!, 0.5), 5.475);

  // u outside 0–1 is clamped rather than extrapolated.
  near(sampleTime(doc.a!, -1), 10);
  near(sampleTime(doc.a!, 2), 11.2);
  console.log("✓ endpoints and phases line up across unequal ranges");
}

// 3. timeToU inverts sampleTime, which is how playback derives master position.
{
  const doc = marked();
  for (const u of [0, 0.13, 0.5, 0.87, 1]) {
    near(timeToU(doc.a!, sampleTime(doc.a!, u)), u, "round-trip A");
    near(timeToU(doc.b!, sampleTime(doc.b!, u)), u, "round-trip B");
  }
  console.log("✓ timeToU inverts sampleTime");
}

// 4. The reference defines master duration and the size of a frame step.
{
  let doc = setReference(marked(), "a");
  near(masterDuration(doc), 1.2);
  assert.equal(referenceClip(doc), doc.a);
  // A is 30fps, so one step is 1/30s out of 1.20s.
  near(frameStepU(doc), 1 / 30 / 1.2);

  doc = setReference(doc, "b");
  near(masterDuration(doc), 0.95);
  // B is 60fps: flipping the reference genuinely changes the step size.
  near(frameStepU(doc), 1 / 60 / 0.95);

  near(uToMaster(doc, 0.5), 0.475);
  near(masterToU(doc, 0.475), 0.5);
  console.log("✓ the reference drives master duration and frame step");
}

// 5. Default reference is the longer range, so nothing plays faster than 1×.
{
  const doc = marked();
  assert.equal(longerSide(doc), "a");
  assert.equal(longerSide(setClip(loaded, "b", null)), "a", "one clip is its own reference");
  assert.equal(longerSide(setClip(loaded, "a", null)), "b");
  console.log("✓ the longer range is the default reference");
}

// 6+7. Both clips traverse their ranges together: equal phase, unequal seconds.
{
  const doc = setReference(marked(), "a");
  // Playback seeks both to `sampleTime(clip, u)`, so "in step" is a property of
  // the mapping, not of any rate: equal fractions of unequal ranges.
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    const intoA = (sampleTime(doc.a!, u) - doc.a!.start) / clipDuration(doc.a!);
    const intoB = (sampleTime(doc.b!, u) - doc.b!.start) / clipDuration(doc.b!);
    near(intoA, u, "A phase");
    near(intoB, u, "B phase");
  }
  // Even absurdly lopsided ranges are fine — there is no rate to be out of.
  const lopsided = setEnd(setStart(loaded, "b", 0), "b", 0.02);
  near(sampleTime(lopsided.b!, 1) - sampleTime(lopsided.b!, 0), 0.02);
  console.log("✓ both clips traverse their ranges in step, at any ratio");
}

// 8. Markers: ordering is enforced, and a start past the end starts over.
{
  const one = frameDuration(loaded.a!);
  let doc = setEnd(setStart(loaded, "a", 10), "a", 12);
  assert.deepEqual([doc.a!.start, doc.a!.end], [10, 12]);

  // The forgiving rule: marking a start at 20 does not collapse the range
  // onto the old end at 12, it reopens to the rest of the clip.
  doc = setStart(doc, "a", 20);
  assert.deepEqual([doc.a!.start, doc.a!.end], [20, 30]);

  // Mirror image: an end before the start reopens back to zero.
  doc = setEnd(doc, "a", 4);
  assert.deepEqual([doc.a!.start, doc.a!.end], [0, 4]);

  // Inside the range, it is a plain move and stays at least a frame wide.
  doc = setStart(doc, "a", 4 - one / 2);
  assert.ok(clipDuration(doc.a!) > 0, "range never collapses to nothing");

  // Bounds hold at both ends of the clip.
  assert.equal(setStart(loaded, "a", -5).a!.start, 0);
  assert.equal(setEnd(loaded, "a", 999).a!.end, 30);
  assert.equal(setStart(EMPTY_DOC, "a", 1), EMPTY_DOC, "no clip, no change");

  doc = resetMarks(doc, "a");
  assert.deepEqual([doc.a!.start, doc.a!.end], [0, 30]);
  console.log("✓ marker ordering, reopening and bounds");
}

// 9. The nudge shifts sampling without moving the markers, and stays in range.
{
  const one = frameDuration(marked().a!);
  let doc = nudgeOffset(marked(), "a", 3);
  assert.deepEqual([doc.a!.start, doc.a!.end], [10, 11.2], "markers must not move");
  near(doc.a!.offset, 3 * one);
  near(sampleTime(doc.a!, 0), 10 + 3 * one);
  near(sampleTime(doc.a!, 1), 11.2 + 3 * one);

  // Wound far enough, the shifted range stops at the clip bounds instead of
  // drifting off the end into a pane that looks frozen.
  doc = nudgeOffset(doc, "a", 100000);
  near(doc.a!.offset, 30 - 11.2);
  near(sampleTime(doc.a!, 1), 30);
  doc = nudgeOffset(doc, "a", -100000);
  near(doc.a!.offset, -10);
  near(sampleTime(doc.a!, 0), 0);

  doc = clearOffset(doc, "a");
  assert.equal(doc.a!.offset, 0);

  // Re-marking re-clamps an offset the new range can no longer support.
  const wound = nudgeOffset(marked(), "b", 100000);
  assert.ok(wound.b!.offset > 0);
  assert.equal(resetMarks(wound, "b").b!.offset, 0, "whole clip leaves no slack");
  console.log("✓ the nudge shifts sampling only, and stays inside the clip");
}

// 10. Missing frame rates fall back rather than dividing by zero.
{
  const noFps = createClip({ width: 640, height: 480, duration: 10, name: "x.mp4" });
  near(frameDuration(noFps), 1 / 30);
  const doc = setClip(setClip(EMPTY_DOC, "a", noFps), "b", createClip(sourceB));
  assert.ok(Number.isFinite(frameStepU(doc)));
  assert.equal(frameStepU(EMPTY_DOC), 0, "nothing loaded, nothing to step");
  assert.equal(masterDuration(EMPTY_DOC), 0);
  assert.equal(masterToU(EMPTY_DOC, 5), 0, "no timeline yet");
  console.log("✓ a missing frame rate falls back to 30fps");
}

// 11. The speed ladder: stepping snaps on, and never slides into reverse.
{
  const rates = [-1, 0.25, 0.5, 1, 2];
  assert.equal(nudgeRate(rates, 0.5, 1), 1);
  assert.equal(nudgeRate(rates, 1, -1), 0.5);
  assert.equal(nudgeRate(rates, 2, 1), 2, "top rung holds");
  assert.equal(nudgeRate(rates, 0.25, -1), 0.25, "bottom rung holds, no reverse");
  assert.equal(nudgeRate(rates, -1, -1), -1, "stepping down out of reverse is a no-op");
  assert.equal(nudgeRate(rates, -1, 1), 0.25, "stepping up leaves reverse");
  assert.equal(nudgeRate(rates, 0.9, 1), 2, "off-ladder snaps to 1, then steps");
  assert.equal(nudgeRate(rates, 0.9, -1), 0.5);
  assert.equal(nudgeRate([], 1, 1), 1, "no forward rungs, no change");
  console.log("✓ the speed ladder steps and snaps");
}

// 13. Zoom keeps the box full of video, and holds the point under the pointer.
{
  assert.deepEqual(DEFAULT_VIEW, { zoom: 1, cx: 0.5, cy: 0.5 });

  // At zoom 1 there is nowhere to pan to: the centre is pinned.
  const panned = panBy(DEFAULT_VIEW, 0.3, -0.3);
  assert.deepEqual(panned, { zoom: 1, cx: 0.5, cy: 0.5 });

  // Zooming into the top-left corner clamps to the corner window, not past it.
  const corner = zoomAt(DEFAULT_VIEW, 0, 0, 2);
  assert.equal(corner.zoom, 2);
  near(corner.cx, 0.25, "corner cx");
  near(corner.cy, 0.25, "corner cy");

  // The point under the pointer stays under the pointer, away from the edges.
  const before = zoomAt(DEFAULT_VIEW, 0.5, 0.5, 2);
  const after = zoomAt(before, 0.6, 0.4, 2);
  const at = (v: typeof after, b: number, axis: "cx" | "cy") => (b - 0.5) / v.zoom + v[axis];
  near(at(before, 0.6, "cx"), at(after, 0.6, "cx"), "anchored x");
  near(at(before, 0.4, "cy"), at(after, 0.4, "cy"), "anchored y");

  // Zoom is bounded, and zooming back out re-centres because of the clamp.
  assert.equal(zoomAt(DEFAULT_VIEW, 0.5, 0.5, 1000).zoom, MAX_ZOOM);
  const out = zoomAt(corner, 0.5, 0.5, 0.001);
  assert.deepEqual(out, { zoom: 1, cx: 0.5, cy: 0.5 });

  // Panning at zoom 4 moves by the drag divided by the zoom, then clamps.
  const wide = clampView({ zoom: 4, cx: 0.5, cy: 0.5 });
  near(panBy(wide, 0.2, 0).cx, 0.5 - 0.05);
  near(panBy(wide, -10, 0).cx, 1 - 0.5 / 4, "clamped to the right edge");
  console.log("✓ zoom anchors on the pointer and stays inside the frame");
}

// 13b. A portrait clip in a 16:9 box: pan vertically, but not into the bars.
{
  const fit = paneFit(9 / 16, 16 / 9);
  near(fit.w, (9 / 16) / (16 / 9), "picture covers only part of the width");
  assert.equal(fit.h, 1, "and all of the height");
  assert.deepEqual(paneFit(16 / 9, 16 / 9), { w: 1, h: 1 }, "matched box, full fit");
  assert.deepEqual(paneFit(0, 1), { w: 1, h: 1 }, "no aspect yet, assume full");

  // At zoom 2 the picture is still narrower than the box, so x stays pinned
  // while y is free to move — panning must not drag the letterbox into view.
  const z2 = clampView({ zoom: 2, cx: 0.2, cy: 0.2 }, fit);
  assert.equal(z2.cx, 0.5, "no horizontal slack yet");
  near(z2.cy, 0.25, "vertical pan clamps to the frame edge");

  // Zoomed far enough that the picture overflows the box, x frees up.
  const z6 = clampView({ zoom: 6, cx: 0, cy: 0.5 }, fit);
  assert.ok(z6.cx < 0.5 && z6.cx > 0, `expected horizontal slack, got ${z6.cx}`);
  near(z6.cx, 0.5 - (fit.w / 2 - 0.5 / 6));
  console.log("✓ letterboxed panning stops at the picture, not the box");
}

// 14. The transform puts the requested point in the middle of the box.
{
  const view = clampView({ zoom: 2, cx: 0.25, cy: 0.75 });
  assert.equal(viewTransform(view), "scale(2) translate(25%, -25%)");
  // Read back the mapping the comment in `viewTransform` describes.
  const land = (p: number, c: number, z: number) => 0.5 + z * (p + (0.5 - c) - 0.5);
  near(land(view.cx, view.cx, view.zoom), 0.5, "cx lands in the middle");
  near(land(view.cy, view.cy, view.zoom), 0.5, "cy lands in the middle");
  assert.equal(viewTransform(DEFAULT_VIEW), "scale(1) translate(0%, 0%)");
  console.log("✓ the CSS transform centres on cx/cy");
}

// 15. Re-opening a source keeps the markers, which are the actual work.
{
  const doc = marked();
  const same = replaceSource(doc.a!, sourceA);
  assert.deepEqual([same.start, same.end, same.offset], [10, 11.2, 0], "same file, same marks");

  // A shorter re-read keeps as much of the range as still exists.
  const short = replaceSource(doc.a!, { ...sourceA, duration: 10.5 });
  assert.equal(short.end, 10.5);
  assert.ok(short.start < short.end && short.start >= 0, "range stays valid");

  // Far shorter than the old start: the range collapses to what fits, not to
  // something inverted.
  const tiny = replaceSource(doc.a!, { ...sourceA, duration: 0.5 });
  assert.ok(tiny.start >= 0 && tiny.end <= 0.5 && tiny.start < tiny.end, `got ${tiny.start}–${tiny.end}`);

  // A nudge the new range cannot support is clamped, not carried over.
  const nudged = nudgeOffset(doc, "a", 5).a!;
  assert.ok(nudged.offset > 0);
  assert.equal(replaceSource(nudged, { ...sourceA, duration: 11.2 }).offset, 0);
  console.log("✓ re-opening a source keeps the markers");
}

// 16. Persistence survives the round trip and refuses to trust bad input.
{
  const doc = setReference(marked(), "b");
  const back = parseDoc(serializeDoc(doc));
  assert.deepEqual(back, doc, "round trip is lossless");

  assert.equal(parseDoc("not json"), null);
  assert.equal(parseDoc("null"), null);
  assert.equal(parseDoc(serializeDoc(EMPTY_DOC)), null, "nothing to restore");
  assert.equal(parseDoc(JSON.stringify({ ...doc, version: 2 })), null, "unknown version");

  // A corrupt B must not cost a good A.
  const half = parseDoc(JSON.stringify({ ...doc, b: { source: { width: 0 } } }));
  assert.ok(half?.a, "A survives");
  assert.equal(half?.b, null, "B is dropped");
  assert.equal(half?.reference, "b", "reference is kept even with the clip gone");

  // Missing numbers fall back rather than producing NaN ranges.
  const sparse = parseDoc(
    JSON.stringify({ version: 1, a: { source: { width: 1920, height: 1080, duration: 5 } } }),
  );
  assert.deepEqual(
    [sparse?.a?.start, sparse?.a?.end, sparse?.a?.offset],
    [0, 5, 0],
    "defaults to the whole clip",
  );
  console.log("✓ markers round-trip through storage, and bad records are refused");
}

console.log("all compare model tests passed");
