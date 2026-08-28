/**
 * The playback-speed ladder shared by the reframe editor and the compare
 * viewer. Pure and DOM-free so it can be tested under
 * `node --experimental-strip-types`.
 */

/**
 * Step `prev` one rung along the forward rates of `rates`.
 *
 * Reverse is a deliberate choice (the `1` key), not somewhere you slide into by
 * stepping down — stepping only ever leaves it. An off-ladder rate snaps to the
 * nearest rung before moving, so the first press lands somewhere predictable.
 */
export function nudgeRate(
  rates: readonly number[],
  prev: number,
  direction: -1 | 1,
): number {
  const forward = rates.filter((rate) => rate > 0);
  if (forward.length === 0) return prev;
  if (prev < 0) return direction > 0 ? forward[0] : prev;

  let i = forward.indexOf(prev);
  if (i === -1) {
    i = forward.reduce(
      (best, rate, idx) =>
        Math.abs(rate - prev) < Math.abs(forward[best] - prev) ? idx : best,
      0,
    );
  }
  return forward[Math.min(forward.length - 1, Math.max(0, i + direction))];
}
