// Public config — safe to ship in the browser, like the Supabase publishable key.
//
// Since late August 2026 CARTO stamps every tile requested without a key with an
// "API KEY REQUIRED" watermark. Keys are free (commercial use: 1M requests a
// month) and are managed at https://carto.com/basemaps/apikey.
export const CARTO_KEY =
  process.env.NEXT_PUBLIC_CARTO_KEY ?? "cb1_47g5_1_c734fdeb0a13adcbe4ead865";

/** The a/b/c CARTO tile hosts for a style path, e.g. "dark_all" or "rastertiles/voyager". */
export function cartoTiles(style: string): string[] {
  return ["a", "b", "c"].map(
    (host) =>
      `https://${host}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`,
  );
}
