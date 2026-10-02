/**
 * Demo clips for the landing page's media slots.
 *
 * Every slot falls back to an inline SVG illustration while its entry is null.
 * To use a real clip: drop a short, muted, looping mp4 in `public/demos/` and set
 * the path here (leading slash, no basePath — `MediaSlot` runs it through `asset()`).
 * Nothing else needs to change.
 */
export const DEMOS: Record<"ar" | "tournaments" | "reframe" | "compare", string | null> = {
  ar: null,
  tournaments: null,
  reframe: null,
  compare: null,
};
