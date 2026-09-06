import assert from "node:assert/strict";
import {
  GAP_LEAD_IN,
  IN_AS_OUT_SLIP,
  NO_MARK,
  cancelMark,
  addSegment,
  clearSegments,
  createDoc,
  exportRanges,
  forceMarkIn,
  fromNormalisedSegment,
  gapRanges,
  markIn,
  markOut,
  mergeSegments,
  minSegmentDuration,
  nextPlayTime,
  normaliseSegments,
  parseDoc,
  reelToSourceTime,
  removeSegment,
  renumberSegments,
  segmentAt,
  segmentEpsilon,
  sourceToReelTime,
  sourceToReelTimeClamped,
  serializeDoc,
  toNormalisedSegment,
  totalSegmentDuration,
  updateSegment,
  type ReframeDoc,
} from "./model.ts";

const source = { width: 1920, height: 1080, duration: 120, name: "match.mp4", frameRate: 30 };
const blank: ReframeDoc = createDoc(source);
const min = minSegmentDuration(blank);

/** Build a doc with the given ranges committed, bypassing the marker keys. */
function withSegments(...ranges: Array<[number, number]>): ReframeDoc {
  return ranges.reduce((doc, [s, e]) => addSegment(doc, s, e).doc, blank);
}
const bounds = (doc: ReframeDoc) => doc.segments.map((s) => [s.start, s.end]);

// 1. A fresh document has no segments and behaves as "the whole clip".
assert.deepEqual(blank.segments, []);
assert.deepEqual(exportRanges(blank), [{ start: 0, end: 120 }]);
assert.equal(nextPlayTime(blank, 42), 42, "no segments means never skip");
console.log("✓ empty document is the whole clip");

// 2. In never touches the document — that is what makes overshooting free.
const two = withSegments([10, 20], [40, 50]);
const before = bounds(two);
let r = markIn(two, NO_MARK, 30);
assert.equal(r.mark.openIn, 30);
assert.deepEqual(bounds(r.doc), before, "In must not modify committed segments");
// Pressing In repeatedly just moves the draft; the last one wins.
r = markIn(r.doc, r.mark, 31);
r = markIn(r.doc, r.mark, 32);
assert.equal(r.mark.openIn, 32);
assert.deepEqual(bounds(r.doc), before);
console.log("✓ In only moves the draft");

// 3. Out with a draft open commits it, and clears the draft.
r = markOut(r.doc, r.mark, 35);
assert.equal(r.mark.openIn, null);
assert.deepEqual(bounds(r.doc), [[10, 20], [32, 35], [40, 50]]);
assert.ok(r.segmentId, "the committed segment is reported for selection");
console.log("✓ Out commits the draft");

// 4. THE INSERT CASE: marking a point in a gap must leave neighbours alone.
const insertDraft = markIn(two, NO_MARK, 25);
const inserted = markOut(insertDraft.doc, insertDraft.mark, 33);
assert.deepEqual(bounds(inserted.doc), [[10, 20], [25, 33], [40, 50]]);
assert.deepEqual(
  [bounds(inserted.doc)[0], bounds(inserted.doc)[2]],
  before,
  "the surrounding segments keep their exact bounds",
);
assert.deepEqual(
  inserted.doc.segments.map((s) => s.name),
  ["Point 1", "Point 2", "Point 3"],
  "auto names renumber around the inserted point",
);
console.log("✓ inserting into a gap leaves neighbours untouched");

// 5. Out with no draft, inside a segment: that point ran longer.
const extended = markOut(two, NO_MARK, 15);
assert.deepEqual(bounds(extended.doc), [[10, 15], [40, 50]]);
const extendedLater = markOut(two, NO_MARK, 19.5);
assert.deepEqual(bounds(extendedLater.doc), [[10, 19.5], [40, 50]]);
console.log("✓ Out inside a segment moves its end");

// 6. Out with no draft, in a gap: retroactive capture, clamped off the neighbour.
const captured = markOut(two, NO_MARK, 30);
assert.deepEqual(bounds(captured.doc), [[10, 20], [30 - GAP_LEAD_IN, 30], [40, 50]]);
// Close behind a segment, the lead-in is clamped rather than swallowing it.
const clamped = markOut(two, NO_MARK, 22);
assert.deepEqual(bounds(clamped.doc), [[10, 22], [40, 50]], "clamped to the previous end, then merged");
console.log("✓ Out in a gap captures a lead-in without reaching across");

// 7. Out with no draft and no segments at all still does something visible.
const fromNothing = markOut(blank, NO_MARK, 8);
assert.equal(fromNothing.doc.segments.length, 1);
assert.deepEqual(bounds(fromNothing.doc), [[8 - GAP_LEAD_IN, 8]]);
console.log("✓ Out from nothing creates a segment");

// 8. Scrubbing backwards before Out still yields a forward range.
const backwards = (() => {
  const m = markIn(blank, NO_MARK, 60);
  return markOut(m.doc, m.mark, 55);
})();
assert.deepEqual(bounds(backwards.doc), [[55, 60]]);
console.log("✓ backwards marking normalises to [min, max]");

// 9. Overlapping and merely touching ranges merge; identity of the earlier wins.
assert.deepEqual(
  mergeSegments(
    [
      { id: "a", name: "Point 1", start: 0, end: 10 },
      { id: "b", name: "Point 2", start: 5, end: 15 },
      { id: "c", name: "Point 3", start: 30, end: 40 },
    ],
    segmentEpsilon(blank),
  ).map((s) => [s.id, s.start, s.end]),
  [["a", 0, 15], ["c", 30, 40]],
);
// Butting ranges (end === start) merge too, so you can't leave a zero gap.
assert.equal(mergeSegments([
  { id: "a", name: "Point 1", start: 0, end: 10 },
  { id: "b", name: "Point 2", start: 10, end: 20 },
], segmentEpsilon(blank)).length, 1);
console.log("✓ merging");

// 10. Renumbering rewrites auto names only.
const named = renumberSegments([
  { id: "a", name: "Point 7", start: 0, end: 1 },
  { id: "b", name: "Sick roll", start: 2, end: 3 },
  { id: "c", name: "Point", start: 4, end: 5 },
]);
assert.deepEqual(named.map((s) => s.name), ["Point 1", "Sick roll", "Point 3"]);
console.log("✓ renumbering preserves typed names");

// 11. updateSegment clamps but never merges — the drag must survive its own gesture.
const dragged = updateSegment(two, two.segments[0].id, { end: 45 });
assert.equal(dragged.segments.length, 2, "still two segments mid-drag, overlapping");
assert.deepEqual(bounds(normaliseSegments(dragged)), [[10, 50]], "merged on commit");
// An edge can't be dragged through its partner.
const collapsed = updateSegment(two, two.segments[0].id, { end: 5 });
assert.ok(collapsed.segments[0].end - collapsed.segments[0].start >= min - 1e-9);
console.log("✓ resize clamps, commit merges");

// 12. Playback skipping.
const play = withSegments([10, 20], [40, 50]);
assert.equal(nextPlayTime(play, 15), 15, "inside a segment, carry on");
assert.equal(nextPlayTime(play, 0), 10, "before the first, jump to it");
assert.equal(nextPlayTime(play, 20), 40, "segments are half-open at the end");
assert.equal(nextPlayTime(play, 55), null, "nothing left to play");
assert.equal(segmentAt(play, 20), null);
assert.ok(segmentAt(play, 19.99));
console.log("✓ nextPlayTime");

// 13. Gaps, totals, export ranges.
assert.deepEqual(gapRanges(play), [
  { start: 0, end: 10 },
  { start: 20, end: 40 },
  { start: 50, end: 120 },
]);
assert.equal(totalSegmentDuration(play), 20);
assert.deepEqual(exportRanges(play), [
  { start: 10, end: 20 },
  { start: 40, end: 50 },
]);
console.log("✓ gaps, totals and export ranges");

// 14. Removing and clearing.
assert.equal(removeSegment(play, play.segments[0].id).segments.length, 1);
assert.deepEqual(clearSegments(play).segments, []);
console.log("✓ remove and clear");

// 15. A document saved before segments existed still loads.
const legacy = JSON.stringify({
  version: 1,
  source,
  target: { width: 1080, height: 1920 },
  keyframes: [{ id: "k1", t: 1, cx: 0.5, cy: 0.5, zoom: 1, easing: "linear" }],
});
assert.deepEqual(parseDoc(legacy).segments, [], "missing segments key means no segments");
console.log("✓ legacy document without segments");

// 16. Round trip, including repair of a hand-edited overlap.
const roundTripped = parseDoc(serializeDoc(play));
assert.deepEqual(bounds(roundTripped), [[10, 20], [40, 50]]);
const messy = JSON.parse(serializeDoc(play));
messy.segments = [
  { id: "x", name: "Point 1", start: 40, end: 50 },
  { id: "y", name: "Point 2", start: 10, end: 45 },
  { id: "z", name: "Zero", start: 60, end: 60 },
];
assert.deepEqual(bounds(parseDoc(JSON.stringify(messy))), [[10, 50]], "sorted, merged, empties dropped");
console.log("✓ round trip and repair");

// 17. The iOS normalised bridge round-trips.
const seg = play.segments[0];
const norm = toNormalisedSegment(play, seg);
assert.equal(norm.startNormalised, 10 / 120);
const back = fromNormalisedSegment(play, norm);
assert.ok(Math.abs(back.start - seg.start) < 1e-9 && Math.abs(back.end - seg.end) < 1e-9);
console.log("✓ normalised bridge");

// 18. In forgives the slip: past an open in-point it does what Out does.
//     This is the mistake that kept happening — reaching for Out and hitting
//     In, which used to throw away the start of the rally being captured.
const draft = markIn(two, NO_MARK, 25);
assert.equal(draft.mark.openIn, 25);

const slipped = markIn(draft.doc, draft.mark, 25 + IN_AS_OUT_SLIP + 5);
assert.equal(slipped.mark.openIn, null, "the draft was committed, not moved");
assert.deepEqual(
  bounds(slipped.doc),
  [[10, 20], [25, 33], [40, 50]],
  "a slip produces the segment the user meant",
);
console.log("✓ In past the slip threshold commits, like Out");

// 19. A small forward nudge is a real correction and still moves the in-point.
const nudged = markIn(draft.doc, draft.mark, 25 + IN_AS_OUT_SLIP - 1);
assert.equal(nudged.mark.openIn, 25 + IN_AS_OUT_SLIP - 1);
assert.deepEqual(bounds(nudged.doc), before, "no segment committed");
// Moving the in-point EARLIER is always a real edit, however far back.
const backwardsMove = markIn(draft.doc, draft.mark, 1);
assert.equal(backwardsMove.mark.openIn, 1);
assert.deepEqual(bounds(backwardsMove.doc), before);
// With no draft open, In always just sets the in-point.
assert.equal(markIn(two, NO_MARK, 99).mark.openIn, 99);
console.log("✓ corrections still move the in-point");

// 20. Shift+In escapes the forgiveness — otherwise setting an in-point far
//     ahead of an open draft would be impossible, and ⌘Z restores the draft,
//     so you would loop.
const forced = forceMarkIn(draft.doc, draft.mark, 25 + IN_AS_OUT_SLIP + 5);
assert.equal(forced.mark.openIn, 25 + IN_AS_OUT_SLIP + 5);
assert.deepEqual(bounds(forced.doc), before, "forcing never commits");
console.log("✓ Shift+In forces the move");

// 21. Escape drops an open draft without committing.
const cancelled = cancelMark(draft.doc);
assert.equal(cancelled.mark.openIn, null);
assert.deepEqual(bounds(cancelled.doc), before);
assert.equal(cancelled.segmentId, null);
console.log("✓ cancel clears the draft");

// 22. Reel time: the timeline in "segments only" mode, and the exporter, both
//     collapse the gaps. Segments [10,20] and [40,50] make a 20s reel.
assert.equal(sourceToReelTime(play, 10), 0, "first segment starts the reel");
assert.equal(sourceToReelTime(play, 15), 5);
assert.equal(sourceToReelTime(play, 40), 10, "second segment follows the first");
assert.equal(sourceToReelTime(play, 45), 15);
assert.equal(sourceToReelTime(play, 30), null, "a gap never reaches the output");
assert.equal(sourceToReelTime(play, 5), null);
// The clamped form resolves a gap to the cut it would be skipped to.
assert.equal(sourceToReelTimeClamped(play, 30), 10);
assert.equal(sourceToReelTimeClamped(play, 5), 0);
assert.equal(sourceToReelTimeClamped(play, 119), totalSegmentDuration(play));
// And it round-trips.
for (const t of [10, 12.5, 19.9, 40, 47, 49.9]) {
  const reel = sourceToReelTime(play, t);
  assert.ok(reel !== null);
  assert.ok(Math.abs(reelToSourceTime(play, reel) - t) < 1e-9, `round trip at ${t}`);
}
assert.equal(reelToSourceTime(play, 0), 10);
assert.equal(reelToSourceTime(play, 10), 40, "the cut lands on the next segment");
assert.equal(reelToSourceTime(play, 999), 50, "past the end clamps to the reel end");
// With no segments, reel time is source time.
assert.equal(reelToSourceTime(blank, 42), 42);
console.log("✓ reel time mapping");

console.log("\nAll model checks passed.");

/* ── Grade: additive, optional, byte-stable back-compat ────────────────── */
import { DEFAULT_GRADE, gradeOf, parseGrade, setGrade } from "./model.ts";

{
  const base = createDoc({ width: 1920, height: 1080, duration: 10, name: "t.mp4", frameRate: 30 });
  // No grade key → the default, and the key stays absent.
  assert.deepEqual(gradeOf(base), DEFAULT_GRADE);
  assert.ok(!("grade" in base));
  // Setting a real value stores it; patching back to default drops the key,
  // so pre-grading documents round-trip byte-stable.
  const graded = setGrade(base, { exposure: 0.5 });
  assert.equal(graded.grade?.exposure, 0.5);
  const reverted = setGrade(graded, { exposure: 0 });
  assert.ok(!("grade" in reverted), "default grade drops the key");
  assert.equal(setGrade(base, {}), base, "no-op patch returns the same doc");
  // Serialise → parse round-trips the grade, and repairs junk.
  const parsed = parseDoc(serializeDoc(graded));
  assert.deepEqual(parsed.grade, graded.grade);
  const noGrade = parseDoc(serializeDoc(base));
  assert.ok(!("grade" in noGrade), "absent grade stays absent through parse");
  assert.equal(parseGrade(undefined), undefined);
  assert.equal(parseGrade({ exposure: 0, saturation: 1, contrast: 1, toneMap: "hable" }), undefined);
  assert.deepEqual(parseGrade({ exposure: 99, toneMap: "sepia" }), {
    exposure: 4, saturation: 1, contrast: 1, toneMap: "hable",
  });
  console.log("✓ grade field");
}

/* ── applyLoadedDoc: fitting a saved document onto the open video ───────── */
import { applyLoadedDoc } from "./model.ts";

{
  // The open clip is shorter than the one the document was written against —
  // the case that matters, because segments are in seconds and would otherwise
  // point past the end.
  const current = createDoc({ width: 1920, height: 1080, duration: 10, name: "open.mp4" });
  const saved = addSegment(
    addSegment(
      {
        ...createDoc({ width: 3840, height: 2160, duration: 30, name: "saved.mp4" }),
        target: { width: 1080, height: 1350 },
        keyframes: [{ id: "k1", t: 4, cx: 0.25, cy: 0.5, zoom: 1.5, easing: "linear" }],
      },
      2,
      6,
    ).doc,
    20,
    26,
  ).doc;

  const { doc, aspectMismatch } = applyLoadedDoc(current, saved);

  // The open video's own metadata survives; only the framing is taken.
  assert.deepEqual(doc.source, current.source, "loaded video's metadata is kept");
  assert.deepEqual(doc.target, { width: 1080, height: 1350 }, "target comes from the document");
  assert.equal(doc.keyframes.length, 1);
  assert.equal(doc.keyframes[0].cx, 0.25, "normalised keyframes carry over untouched");
  // 2–6 fits; 20–26 sits entirely past the 10s end and is dropped rather than
  // collapsing to a zero-length segment at the boundary.
  assert.equal(doc.segments.length, 1, "out-of-range segments are dropped");
  assert.deepEqual(
    [doc.segments[0].start, doc.segments[0].end],
    [2, 6],
    "an in-range segment is untouched",
  );
  // 16:9 → 16:9 despite 1080p vs 4K.
  assert.equal(aspectMismatch, false, "same aspect at a different resolution is not a mismatch");
  console.log("✓ applyLoadedDoc clamps and keeps the open video's metadata");
}

{
  // A segment straddling the end is truncated, not dropped.
  const current = createDoc({ width: 1920, height: 1080, duration: 10, name: "open.mp4" });
  const saved = addSegment(
    createDoc({ width: 1080, height: 1920, duration: 30, name: "vertical.mp4" }),
    8,
    20,
  ).doc;
  const { doc, aspectMismatch } = applyLoadedDoc(current, saved);
  assert.deepEqual([doc.segments[0].start, doc.segments[0].end], [8, 10], "clamped to the end");
  assert.equal(aspectMismatch, true, "9:16 onto 16:9 is flagged");
  console.log("✓ applyLoadedDoc truncates and flags an aspect change");
}

console.log("All grade checks passed.");
