import assert from "node:assert/strict";
import { DEFAULT_GRADE, type ReframeGrade } from "./model.ts";
import {
  applyContrast,
  bt2020ToBt709,
  cssGradeFilter,
  fragmentShaderSource,
  hlgInverseOetf,
  oetf709,
  pqInverseEotf,
  tonemapHable,
  tonemapPixel,
  tonemapReinhard,
} from "./tonemap.ts";

const close = (a: number, b: number, tol: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// 1. HLG inverse OETF anchors, from BT.2100: the two branches meet at 0.5
// with the value exactly 1/12, and signal 0.75 is the BT.2408 diffuse white.
assert.equal(hlgInverseOetf(0.5), 0.25 / 3, "branches meet at 1/12");
close(hlgInverseOetf(0.75), 0.264939, 5e-5, "diffuse white scene light");
close(hlgInverseOetf(1), 1, 2e-4, "peak maps to ~1");
assert.equal(hlgInverseOetf(0), 0);
// Through the γ1.2 OOTF an achromatic 0.75 lands on 203/1000 nits.
close(Math.pow(hlgInverseOetf(0.75), 1.2), 0.2031, 2e-4, "BT.2408 white after OOTF");
console.log("✓ HLG inverse OETF");

// 2. PQ anchors: 100 nits is signal 0.508078, and the curve pins its ends.
close(pqInverseEotf(0.508078), 0.01, 1e-5, "PQ 100 nits");
close(pqInverseEotf(1), 1, 1e-9, "PQ peak");
assert.equal(pqInverseEotf(0), 0);
console.log("✓ PQ inverse EOTF");

// 3. Operators: white points map to exactly 1, and both are monotonic.
assert.equal(tonemapHable(11.2), 1, "hable white point");
assert.equal(tonemapReinhard(10, 10), 1, "reinhard peak");
for (let i = 1; i <= 200; i++) {
  const a = (i - 1) / 10;
  const b = i / 10;
  assert.ok(tonemapHable(b) > tonemapHable(a), `hable monotonic at ${b}`);
  assert.ok(tonemapReinhard(b, 10) > tonemapReinhard(a, 10), `reinhard monotonic at ${b}`);
}
console.log("✓ operators");

// 4. Gamut matrix: white stays white (catches a transposed matrix), and pure
// BT.2020 primaries leave the BT.709 gamut in the expected direction.
const white = bt2020ToBt709([1, 1, 1]);
close(white[0], 1, 1e-9, "white R");
close(white[1], 1, 1e-9, "white G");
close(white[2], 1, 1e-9, "white B");
const red = bt2020ToBt709([1, 0, 0]);
assert.ok(red[0] > 1 && red[1] < 0 && red[2] < 0, "2020 red is outside 709");
console.log("✓ gamut matrix");

// 5. OETF and the CSS-parity invariants.
// The two BT.709 branches are ~3e-4 apart at the knee by the standard's own
// constants, so probe each side rather than the exact joint.
assert.equal(oetf709(0.017), 4.5 * 0.017, "OETF linear branch");
close(oetf709(0.018), 1.099 * Math.pow(0.018, 0.45) - 0.099, 1e-12, "OETF power branch");
close(oetf709(1), 1, 1e-9, "OETF peak");
for (const c of [0.5, 1, 1.7]) {
  assert.equal(applyContrast(0.5, c), 0.5, `contrast fixed point at ${c}`);
}
console.log("✓ OETF + contrast");

// 6. End-to-end pipeline sanity. Achromatic in → achromatic out, monotone in
// the signal, and the full-scale white of each transfer lands near 1.
const grade = DEFAULT_GRADE;
let prev = -1;
for (let i = 0; i <= 20; i++) {
  const s = i / 20;
  const [r, g, b] = tonemapPixel([s, s, s], { transfer: "hlg", grade });
  close(r, g, 1e-9, "achromatic stays achromatic");
  close(g, b, 1e-9, "achromatic stays achromatic");
  assert.ok(r >= prev, `pipeline monotonic at ${s}`);
  prev = r;
}
const [peakOut] = tonemapPixel([1, 1, 1], { transfer: "hlg", grade });
assert.ok(peakOut > 0.95 && peakOut <= 1, "HLG peak rolls off near white");
// Diffuse white (signal 0.75 → 2.03 in npl units) must survive bright, not
// grey — this is the number "washed out" is decided by. The browser's flat
// conversion leaves it around 0.48 encoded; Hable holds it near 0.70.
const [diffuse] = tonemapPixel([0.75, 0.75, 0.75], { transfer: "hlg", grade });
assert.ok(diffuse > 0.65, `diffuse white stays bright, got ${diffuse}`);
// Exposure: +1 stop brightens, -1 stop darkens.
const plus = tonemapPixel([0.6, 0.6, 0.6], {
  transfer: "hlg",
  grade: { ...grade, exposure: 1 },
})[0];
const minus = tonemapPixel([0.6, 0.6, 0.6], {
  transfer: "hlg",
  grade: { ...grade, exposure: -1 },
})[0];
const mid = tonemapPixel([0.6, 0.6, 0.6], { transfer: "hlg", grade })[0];
assert.ok(minus < mid && mid < plus, "exposure orders output");
// toneMap "none" clips instead of rolling off: at peak both reach 1, but a
// mid-high value must be *brighter* under none than under hable's shoulder.
const noneGrade: ReframeGrade = { ...grade, toneMap: "none" };
const [noneMid] = tonemapPixel([0.9, 0.9, 0.9], { transfer: "hlg", grade: noneGrade });
assert.equal(noneMid, 1, "unmapped highlights clip");
console.log("✓ tonemapPixel");

// 7. The emitted GLSL contains the same constants and full pipeline stages.
for (const transfer of ["hlg", "pq"] as const) {
  for (const toneMap of ["hable", "reinhard"] as const) {
    const src = fragmentShaderSource({ transfer, toneMap });
    assert.ok(src.includes("#version 300 es"), "ES 3.00");
    assert.ok(src.includes("uExposureGain"), "grade uniforms present");
    assert.ok(src.includes("1.660491"), "gamut matrix interpolated");
    // 0.2627 has no exact binary form; match the literal's leading digits.
    assert.match(src, /LUMA_2020 = vec3\(0\.262/, "2020 luma interpolated");
    if (transfer === "hlg") assert.ok(src.includes("/ 3.0"), "HLG branch present");
  }
}
assert.ok(
  fragmentShaderSource({ transfer: "hlg", toneMap: "hable" }).includes("hable(x) / hable("),
  "hable operator normalises by its white point",
);
console.log("✓ GLSL emission");

// 8. The preview filter string matches the shader's post-OETF stage and emits
// nothing for the default grade (so SDR previews stay untouched).
assert.equal(cssGradeFilter(DEFAULT_GRADE), "");
assert.equal(
  cssGradeFilter({ exposure: 1, contrast: 1.2, saturation: 0.8, toneMap: "hable" }),
  "brightness(2) contrast(1.2) saturate(0.8)",
);
console.log("✓ CSS grade filter");

console.log("\nAll tonemap checks passed.");

/* ── Raw YUV planes → R'G'B' signal ────────────────────────────────────── */
import {
  chromaSamplePlanar,
  parsePixelFormat,
  planeDimensions,
  yuvFragmentShaderSource,
  yuvPixelToRgb,
  yuvToRgbCoefficients,
  type YuvLayout,
} from "./tonemap.ts";

// 9. Range expansion anchors. Full-range 8-bit neutral: the old probe values.
const full2020: YuvLayout = { matrix: "bt2020-ncl", fullRange: true, bitDepth: 8 };
const lim2020: YuvLayout = { matrix: "bt2020-ncl", fullRange: false, bitDepth: 8 };
const lim2020p10: YuvLayout = { matrix: "bt2020-ncl", fullRange: false, bitDepth: 10 };
{
  const [r, g, b] = yuvPixelToRgb(191, 128, 128, full2020);
  close(r, 191 / 255, 1e-9, "full-range neutral R");
  close(g, 191 / 255, 1e-9, "full-range neutral G");
  close(b, 191 / 255, 1e-9, "full-range neutral B");
  // Limited 8-bit: 16 → 0, 235 → 1 on all channels when chroma is neutral.
  assert.deepEqual(yuvPixelToRgb(16, 128, 128, lim2020), [0, 0, 0]);
  const [wr, wg, wb] = yuvPixelToRgb(235, 128, 128, lim2020);
  close(wr, 1, 1e-9, "limited white R");
  close(wg, 1, 1e-9, "limited white G");
  close(wb, 1, 1e-9, "limited white B");
  // Limited 10-bit: 64 → 0, 940 → 1.
  assert.deepEqual(yuvPixelToRgb(64, 512, 512, lim2020p10), [0, 0, 0]);
  const [t] = yuvPixelToRgb(940, 512, 512, lim2020p10);
  close(t, 1, 1e-9, "10-bit limited white");
  console.log("✓ YUV range expansion");
}

// 10. Matrix behaviour: neutral chroma is achromatic for every matrix, and a
// saturated sample decodes differently under bt709 vs bt2020 coefficients.
for (const matrix of ["bt2020-ncl", "bt709", "smpte170m"] as const) {
  const [r, g, b] = yuvPixelToRgb(500, 512, 512, { matrix, fullRange: false, bitDepth: 10 });
  close(r, g, 1e-9, `${matrix} neutral achromatic`);
  close(g, b, 1e-9, `${matrix} neutral achromatic`);
  // Coefficient identities: rows of the inverse matrix reconstruct Y.
  const k = yuvToRgbCoefficients({ matrix, fullRange: false, bitDepth: 8 });
  assert.ok(k.rCr > 0 && k.bCb > 0 && k.gCb < 0 && k.gCr < 0, `${matrix} signs`);
}
{
  const a = yuvPixelToRgb(400, 300, 700, { matrix: "bt2020-ncl", fullRange: false, bitDepth: 10 });
  const c = yuvPixelToRgb(400, 300, 700, { matrix: "bt709", fullRange: false, bitDepth: 10 });
  assert.ok(Math.abs(a[0] - c[0]) > 0.005, "matrices actually differ on saturated input");
  console.log("✓ YUV matrices");
}

// 11. Pixel-format parsing and plane geometry.
{
  assert.deepEqual(parsePixelFormat("NV12"), {
    chroma: "nv12", bitDepth: 8, planeCount: 2, hasAlpha: false,
  });
  assert.deepEqual(parsePixelFormat("I420P10"), {
    chroma: "i420", bitDepth: 10, planeCount: 3, hasAlpha: false,
  });
  assert.deepEqual(parsePixelFormat("I444A"), {
    chroma: "i444", bitDepth: 8, planeCount: 4, hasAlpha: true,
  });
  assert.equal(parsePixelFormat("RGBA"), null, "RGB formats are already converted");
  assert.equal(parsePixelFormat("BGRX"), null);
  assert.equal(parsePixelFormat("bogus"), null);

  const i420 = planeDimensions(parsePixelFormat("I420")!, 1920, 1080);
  assert.deepEqual(i420[1], { width: 960, height: 540, samplesPerPixel: 1 });
  const nv12 = planeDimensions(parsePixelFormat("NV12")!, 1919, 1079);
  assert.deepEqual(nv12[1], { width: 960, height: 540, samplesPerPixel: 2 }, "odd dims round up");
  const i422 = planeDimensions(parsePixelFormat("I422")!, 1920, 1080);
  assert.deepEqual(i422[1], { width: 960, height: 1080, samplesPerPixel: 1 });
  console.log("✓ pixel formats + plane geometry");
}

// 12. Chroma bilinear: constant planes pass through exactly; at a luma pixel
// exactly over a chroma sample (x=2c+0..) the centred siting interpolates —
// pin one hand-computed value so the GLSL twin has a numeric anchor.
{
  const flat = () => 512;
  close(chromaSamplePlanar(flat, 960, 540, 123, 77, "i420"), 512, 1e-9, "flat plane");
  const ramp = (x: number) => x;
  // Luma x=4 → chroma coord 1.75 → mix(1, 2, 0.75) = 1.75.
  close(chromaSamplePlanar(ramp, 960, 1, 4, 0, "i422"), 1.75, 1e-9, "i422 siting");
  // Edges clamp instead of reading out of bounds.
  close(chromaSamplePlanar(ramp, 960, 1, 0, 0, "i422"), 0, 1e-9, "left edge clamps");
  close(chromaSamplePlanar(ramp, 960, 1, 1919, 0, "i422"), 959, 1e-9, "right edge clamps");
  console.log("✓ chroma bilinear siting");
}

// 13. The pass-A GLSL twin carries the same constants.
{
  const src = yuvFragmentShaderSource({ layout: lim2020p10, chroma: "i420" });
  assert.ok(src.includes("usampler2D"), "10-bit uses integer samplers");
  assert.ok(src.includes("#version 300 es"), "ES 3.00");
  // Node can't compile GLSL, but it can catch identifier drift between the
  // emitted snippets: `p` is cAt's parameter, `pos` is main's — the luma
  // fetch must use pos. (This exact mismatch shipped once; Safari caught it.)
  for (const chroma of ["i420", "i422", "i444", "nv12"] as const) {
    const s = yuvFragmentShaderSource({
      layout: chroma === "nv12" ? { ...lim2020p10, bitDepth: 8 } : lim2020p10,
      chroma,
    });
    assert.ok(s.includes("texelFetch(uY, pos, 0)"), `${chroma}: luma fetch uses pos`);
    const body = s.slice(s.indexOf("void main"));
    assert.ok(!/[^a-zA-Z_]p[^a-zA-Z0-9_(]/.test(body.replace(/pos/g, "P")), `${chroma}: no stray p in main`);
  }
  const k = yuvToRgbCoefficients(lim2020p10);
  assert.ok(src.includes(k.rCr.toPrecision(17)), "rCr interpolated");
  assert.ok(src.includes("axisWeights"), "chroma bilinear present");
  const nv12src = yuvFragmentShaderSource({
    layout: { matrix: "bt709", fullRange: false, bitDepth: 8 },
    chroma: "nv12",
  });
  assert.ok(nv12src.includes(".rg) * 255.0"), "NV12 reads interleaved UV");
  assert.ok(!nv12src.includes("usampler2D"), "NV12 is 8-bit");
  const i444src = yuvFragmentShaderSource({ layout: full2020, chroma: "i444" });
  assert.ok(!i444src.includes("axisWeights(float(pos.x)"), "i444 skips interpolation");
  console.log("✓ pass-A GLSL emission");
}

console.log("All YUV checks passed.");
