/**
 * HDR → SDR tone mapping for the reframe export.
 *
 * The export receives decoded HDR (HLG/PQ) frames whose raw signal the browser
 * would otherwise flatten on its `drawImage` path. Instead, a WebGL fragment
 * shader runs this pipeline per pixel:
 *
 *   inverse EOTF → (HLG) OOTF γ1.2 → scale to npl=100 units → exposure →
 *   desaturate-then-tone-map on the max channel → BT.2020→BT.709 in linear
 *   light → BT.709 OETF → contrast → saturation
 *
 * This module implements that pipeline twice on purpose: once in TypeScript
 * (`tonemapPixel`, testable in Node) and once as emitted GLSL
 * (`fragmentShaderSource`) with the *same constants* interpolated in. The
 * `?debug=1` panel runs the compiled shader over a ramp and compares it to the
 * TypeScript, so the two cannot silently drift.
 *
 * Normalisation anchors (what makes the output match the ffmpeg reference
 * `zscale=t=linear:npl=100,tonemap=hable:desat=2,zscale=p=bt709:t=bt709`):
 * HLG diffuse white — signal 0.75 → inverse OETF 0.2649 → OOTF → 0.2031
 * (203/1000 nits, BT.2408) → ×10 = npl-100 units where 1.0 = 100 nits.
 *
 * Like model.ts/solve.ts this file is dependency-free and DOM-free, so the
 * Swift port can reproduce it number for number.
 */

import { clamp, type ReframeGrade, type ReframeToneMap } from "./model.ts";

/**
 * WebCodecs transfer names, which is what mediabunny reports. (ffmpeg spells
 * these `arib-std-b67` / `smpte2084`; those spellings never appear in code.)
 */
export type SourceTransfer = "hlg" | "pq";

/* ── Constants (shared verbatim with the emitted GLSL) ─────────────────── */

// HLG OETF constants, ITU-R BT.2100.
const HLG_A = 0.17883277;
const HLG_B = 1 - 4 * HLG_A;
const HLG_C = 0.5 - HLG_A * Math.log(4 * HLG_A);
/** HLG OOTF system gamma at the 1000-nit reference display. */
const HLG_GAMMA = 1.2;

// PQ (SMPTE ST 2084) EOTF constants.
const PQ_M1 = 2610 / 16384;
const PQ_M2 = (2523 / 4096) * 128;
const PQ_C1 = 3424 / 4096;
const PQ_C2 = (2413 / 4096) * 32;
const PQ_C3 = (2392 / 4096) * 32;

/**
 * Scale from the transfer's own linear range into npl=100 units (1.0 = 100
 * nits): HLG display-linear 1.0 is the 1000-nit nominal peak, PQ 1.0 is
 * 10000 nits.
 */
const NPL_SCALE: Record<SourceTransfer, number> = { hlg: 10, pq: 100 };

/** Signal peak in npl-100 units, used by the reinhard operator. */
const PEAK: Record<SourceTransfer, number> = { hlg: 10, pq: 100 };

/** BT.2020 luminance weights (linear light). */
const LUMA_2020 = [0.2627, 0.678, 0.0593] as const;

/** BT.709 luma weights the CSS `saturate()` feColorMatrix uses. */
const LUMA_709 = [0.213, 0.715, 0.072] as const;

/** ffmpeg `tonemap=…:desat=2` — highlight desaturation strength. */
const DESAT = 2;

/** Hable / Uncharted 2 filmic curve constants, and its classic white point. */
const HABLE_A = 0.15;
const HABLE_B = 0.5;
const HABLE_C = 0.1;
const HABLE_D = 0.2;
const HABLE_E = 0.02;
const HABLE_F = 0.3;
const HABLE_W = 11.2;

/** ffmpeg `tonemap=reinhard` contrast parameter. */
const REINHARD_PARAM = 0.5;

// BT.2020 → BT.709 primaries conversion, in linear light. Rows sum to 1, so
// white maps to white — which is what the transposed-matrix test checks.
const M_2020_TO_709 = [
  [1.6604910021084354, -0.5876411387885495, -0.07284986331988474],
  [-0.12455047452159074, 1.1328998971259596, -0.008349422604369515],
  [-0.01815076335490521, -0.10057889800800737, 1.1187296613629127],
] as const;

/* ── The pipeline, in TypeScript ───────────────────────────────────────── */

/** Non-linear HLG signal (0–1) → scene-linear light (0–1). */
export function hlgInverseOetf(e: number): number {
  return e <= 0.5 ? (e * e) / 3 : (Math.exp((e - HLG_C) / HLG_A) + HLG_B) / 12;
}

/** Non-linear PQ signal (0–1) → display-linear light (1.0 = 10000 nits). */
export function pqInverseEotf(e: number): number {
  const p = Math.pow(Math.max(e, 0), 1 / PQ_M2);
  return Math.pow(Math.max(p - PQ_C1, 0) / (PQ_C2 - PQ_C3 * p), 1 / PQ_M1);
}

/** Hable filmic curve, normalised so {@link HABLE_W} maps to exactly 1. */
export function tonemapHable(x: number): number {
  const hable = (v: number) =>
    (v * (HABLE_A * v + HABLE_C * HABLE_B) + HABLE_D * HABLE_E) /
      (v * (HABLE_A * v + HABLE_B) + HABLE_D * HABLE_F) -
    HABLE_E / HABLE_F;
  return hable(x) / hable(HABLE_W);
}

/** ffmpeg's reinhard variant: peak maps to exactly 1. */
export function tonemapReinhard(x: number, peak: number): number {
  return ((x / (x + REINHARD_PARAM)) * (peak + REINHARD_PARAM)) / peak;
}

/** BT.2020 → BT.709 primaries, linear light. May leave the 0–1 range. */
export function bt2020ToBt709(
  rgb: readonly [number, number, number],
): [number, number, number] {
  const [r, g, b] = rgb;
  return [
    M_2020_TO_709[0][0] * r + M_2020_TO_709[0][1] * g + M_2020_TO_709[0][2] * b,
    M_2020_TO_709[1][0] * r + M_2020_TO_709[1][1] * g + M_2020_TO_709[1][2] * b,
    M_2020_TO_709[2][0] * r + M_2020_TO_709[2][1] * g + M_2020_TO_709[2][2] * b,
  ];
}

/** BT.709 OETF: display-linear 0–1 → non-linear signal 0–1. */
export function oetf709(l: number): number {
  return l < 0.018 ? 4.5 * l : 1.099 * Math.pow(l, 0.45) - 0.099;
}

/** CSS `contrast(c)` on one non-linear channel. Fixed point at 0.5. */
export function applyContrast(v: number, c: number): number {
  return (v - 0.5) * c + 0.5;
}

/**
 * The whole pipeline: raw HDR signal in, sRGB-ish (BT.709-encoded) pixel out.
 * The GPU must agree with this to ~1/255 — see the `?debug=1` self-test.
 */
export function tonemapPixel(
  signal: readonly [number, number, number],
  opts: { transfer: SourceTransfer; grade: ReframeGrade },
): [number, number, number] {
  const { transfer, grade } = opts;
  const inv = transfer === "pq" ? pqInverseEotf : hlgInverseOetf;
  let r = inv(clamp(signal[0], 0, 1));
  let g = inv(clamp(signal[1], 0, 1));
  let b = inv(clamp(signal[2], 0, 1));

  if (transfer === "hlg") {
    // OOTF: display light = Ys^(γ-1) · scene light, Ys = scene luminance.
    const ys = Math.max(LUMA_2020[0] * r + LUMA_2020[1] * g + LUMA_2020[2] * b, 1e-6);
    const gain = Math.pow(ys, HLG_GAMMA - 1);
    r *= gain;
    g *= gain;
    b *= gain;
  }
  const scale = NPL_SCALE[transfer] * Math.pow(2, grade.exposure);
  r *= scale;
  g *= scale;
  b *= scale;

  if (grade.toneMap !== "none") {
    // ffmpeg's desat step, or the hable comparison is apples-to-oranges.
    const luma = LUMA_2020[0] * r + LUMA_2020[1] * g + LUMA_2020[2] * b;
    const overbright = Math.max(luma - DESAT, 1e-6) / Math.max(luma, 1e-6);
    r += (luma - r) * overbright;
    g += (luma - g) * overbright;
    b += (luma - b) * overbright;

    // Tone-map the max channel and scale the pixel by the ratio: hue-preserving,
    // rolls highlights off instead of clipping them flat.
    const sig = Math.max(Math.max(r, g), Math.max(b, 1e-6));
    const mapped =
      grade.toneMap === "hable" ? tonemapHable(sig) : tonemapReinhard(sig, PEAK[transfer]);
    const ratio = mapped / sig;
    r *= ratio;
    g *= ratio;
    b *= ratio;
  }

  [r, g, b] = bt2020ToBt709([r, g, b]);
  r = clamp(r, 0, 1);
  g = clamp(g, 0, 1);
  b = clamp(b, 0, 1);

  r = oetf709(r);
  g = oetf709(g);
  b = oetf709(b);

  r = clamp(applyContrast(r, grade.contrast), 0, 1);
  g = clamp(applyContrast(g, grade.contrast), 0, 1);
  b = clamp(applyContrast(b, grade.contrast), 0, 1);

  const y = LUMA_709[0] * r + LUMA_709[1] * g + LUMA_709[2] * b;
  r = clamp(y + (r - y) * grade.saturation, 0, 1);
  g = clamp(y + (g - y) * grade.saturation, 0, 1);
  b = clamp(y + (b - y) * grade.saturation, 0, 1);

  return [r, g, b];
}

/**
 * The CSS filter equivalent of the grade's post-OETF stage, for the preview.
 * Contrast and saturation are the exact same formulas the shader runs;
 * `brightness()` only *approximates* exposure on HDR, because it acts on
 * already-tone-mapped display pixels instead of linear light.
 */
export function cssGradeFilter(grade: ReframeGrade): string {
  const parts: string[] = [];
  if (grade.exposure !== 0) parts.push(`brightness(${Math.pow(2, grade.exposure)})`);
  if (grade.contrast !== 1) parts.push(`contrast(${grade.contrast})`);
  if (grade.saturation !== 1) parts.push(`saturate(${grade.saturation})`);
  return parts.join(" ");
}

/* ── Raw YUV planes → R'G'B' signal ────────────────────────────────────── */
/*
 * The browser converts (tone-maps) HDR frames on every image-shaped route to
 * the GPU — texImage2D of a VideoFrame, drawImage, copyTo({format:"RGBA"}) —
 * so the only trustworthy transport is VideoFrame.copyTo() with no format
 * option, which yields the raw YUV planes. This section is the maths that
 * turns those planes back into the non-linear R'G'B' signal the tone-map
 * pipeline above expects: range expansion + the matrix-coefficients inverse.
 * Same double-implementation contract as the pipeline: TypeScript reference
 * here, GLSL emitted from the same constants below.
 */

/** The YCbCr matrix coefficients we support (WebCodecs names). */
export type YuvMatrix = "bt2020-ncl" | "bt709" | "smpte170m";

export interface YuvLayout {
  matrix: YuvMatrix;
  fullRange: boolean;
  bitDepth: 8 | 10 | 12;
}

/** Kr/Kb per matrix (Kg = 1 − Kr − Kb). */
const YUV_KR_KB: Record<YuvMatrix, [number, number]> = {
  "bt2020-ncl": [0.2627, 0.0593],
  bt709: [0.2126, 0.0722],
  smpte170m: [0.299, 0.114],
};

export interface YuvCoefficients {
  /** Normalisation: y' = (Y − yOffset) · yScale, c = (C − cOffset) · cScale. */
  yOffset: number;
  yScale: number;
  cOffset: number;
  cScale: number;
  /** R = y' + rCr·cr;  G = y' + gCb·cb + gCr·cr;  B = y' + bCb·cb. */
  rCr: number;
  gCb: number;
  gCr: number;
  bCb: number;
}

/**
 * Range-expansion and matrix constants for one plane layout.
 *
 * Limited range (the video default): Y spans 16–235 · 2^(n−8), chroma
 * 16–240 · 2^(n−8) centred on 128 · 2^(n−8). Full range: 0–(2^n − 1), chroma
 * centred on 2^(n−1). Code values arrive as-is (10-bit values occupy the low
 * bits of their 16-bit containers, per WebCodecs).
 */
export function yuvToRgbCoefficients(layout: YuvLayout): YuvCoefficients {
  const shift = Math.pow(2, layout.bitDepth - 8);
  const full = Math.pow(2, layout.bitDepth) - 1;
  const [kr, kb] = YUV_KR_KB[layout.matrix];
  const kg = 1 - kr - kb;
  return {
    yOffset: layout.fullRange ? 0 : 16 * shift,
    yScale: layout.fullRange ? 1 / full : 1 / (219 * shift),
    cOffset: layout.fullRange ? Math.pow(2, layout.bitDepth - 1) : 128 * shift,
    cScale: layout.fullRange ? 1 / full : 1 / (224 * shift),
    rCr: 2 * (1 - kr),
    gCb: (-2 * (1 - kb) * kb) / kg,
    gCr: (-2 * (1 - kr) * kr) / kg,
    bCb: 2 * (1 - kb),
  };
}

/**
 * One pixel of raw code values → non-linear R'G'B' signal in [0,1].
 * The GPU's pass-A shader must agree with this to ~1/255.
 */
export function yuvPixelToRgb(
  y: number,
  cb: number,
  cr: number,
  layout: YuvLayout,
): [number, number, number] {
  const k = yuvToRgbCoefficients(layout);
  const yn = (y - k.yOffset) * k.yScale;
  const cbn = (cb - k.cOffset) * k.cScale;
  const crn = (cr - k.cOffset) * k.cScale;
  return [
    clamp(yn + k.rCr * crn, 0, 1),
    clamp(yn + k.gCb * cbn + k.gCr * crn, 0, 1),
    clamp(yn + k.bCb * cbn, 0, 1),
  ];
}

/** Chroma sub-sampling shape of a pixel format. */
export type ChromaLayout = "i420" | "i422" | "i444" | "nv12";

export interface PixelFormatDesc {
  chroma: ChromaLayout;
  bitDepth: 8 | 10 | 12;
  /** Data planes in the buffer, including an ignored alpha plane if present. */
  planeCount: number;
  hasAlpha: boolean;
}

/**
 * Parse a WebCodecs / mediabunny pixel-format name into what the raw-plane
 * renderer needs, or null for formats it cannot take (RGB formats have
 * already been colour-converted by the browser; unknown names are unknown).
 */
export function parsePixelFormat(format: string): PixelFormatDesc | null {
  const m = /^(I420|I422|I444|NV12)(A?)(?:P(10|12))?$/.exec(format);
  if (!m) return null;
  const hasAlpha = m[2] === "A";
  if (m[1] === "NV12") {
    return hasAlpha || m[3] ? null : { chroma: "nv12", bitDepth: 8, planeCount: 2, hasAlpha: false };
  }
  const chroma = m[1].toLowerCase() as ChromaLayout;
  const bitDepth = (m[3] ? Number(m[3]) : 8) as 8 | 10 | 12;
  return { chroma, bitDepth, planeCount: hasAlpha ? 4 : 3, hasAlpha };
}

/**
 * Per-plane pixel dimensions for a visible width×height, in the order the
 * planes appear in a copyTo buffer. `samplesPerPixel` is 2 for NV12's
 * interleaved UV plane (one texel holds Cb+Cr), else 1.
 */
export function planeDimensions(
  desc: PixelFormatDesc,
  width: number,
  height: number,
): Array<{ width: number; height: number; samplesPerPixel: 1 | 2 }> {
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  const y = { width, height, samplesPerPixel: 1 as const };
  switch (desc.chroma) {
    case "nv12":
      return [y, { width: cw, height: ch, samplesPerPixel: 2 }];
    case "i420":
      return [
        y,
        { width: cw, height: ch, samplesPerPixel: 1 },
        { width: cw, height: ch, samplesPerPixel: 1 },
      ];
    case "i422":
      return [
        y,
        { width: cw, height, samplesPerPixel: 1 },
        { width: cw, height, samplesPerPixel: 1 },
      ];
    case "i444":
      return [y, { ...y }, { ...y }];
  }
}

/**
 * The chroma sampling position for a luma pixel, shared by the TypeScript
 * ground-truth check and the emitted GLSL: centred ("JPEG") siting, bilinear
 * between the two/four nearest chroma samples, clamped at the edges.
 */
export function chromaSamplePlanar(
  plane: (x: number, y: number) => number,
  planeW: number,
  planeH: number,
  x: number,
  y: number,
  chroma: ChromaLayout,
): number {
  const sampleAxis = (v: number, size: number): [number, number, number] => {
    const f = v * 0.5 - 0.25;
    const i0 = Math.floor(f);
    const t = f - i0;
    const a = clamp(i0, 0, size - 1);
    const b = clamp(i0 + 1, 0, size - 1);
    return [a, b, t];
  };
  if (chroma === "i444") return plane(x, y);
  const [x0, x1, tx] = sampleAxis(x, planeW);
  if (chroma === "i422") {
    return plane(x0, y) + (plane(x1, y) - plane(x0, y)) * tx;
  }
  const [y0, y1, ty] = sampleAxis(y, planeH);
  const top = plane(x0, y0) + (plane(x1, y0) - plane(x0, y0)) * tx;
  const bottom = plane(x0, y1) + (plane(x1, y1) - plane(x0, y1)) * tx;
  return top + (bottom - top) * ty;
}

/* ── GLSL emission ─────────────────────────────────────────────────────── */

/** A number as a GLSL float literal, at full fp32-and-then-some precision. */
function glsl(n: number): string {
  const s = n.toPrecision(17);
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
}

/**
 * Vertex shader shared by the tone-map and passthrough programs. `aPos` is the
 * output position in [0,1]² with y down (canvas convention); `uTexMatrix` is
 * {@link cropTexMatrix}'s column-major mat3 mapping it to texture coordinates.
 * The clip-space y flip lives here so `UNPACK_FLIP_Y_WEBGL` can stay false —
 * flipping forces a slow video-upload path on some drivers.
 */
export const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform mat3 uTexMatrix;
out vec2 vTex;
void main() {
  vec3 t = uTexMatrix * vec3(aPos, 1.0);
  vTex = t.xy;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}
`;

/** Trivial sampler, for the raw-upload probes. */
export const PASSTHROUGH_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vTex;
out vec4 outColor;
void main() {
  outColor = vec4(texture(uTex, vTex).rgb, 1.0);
}
`;

/**
 * The fragment shader implementing {@link tonemapPixel} for one transfer and
 * operator. Grade values ride in as uniforms (so slider changes don't
 * recompile); everything else is interpolated from the constants above.
 */
export function fragmentShaderSource(opts: {
  transfer: SourceTransfer;
  toneMap: ReframeToneMap;
}): string {
  const { transfer, toneMap } = opts;

  const invTransfer =
    transfer === "pq"
      ? `float invTransfer(float e) {
  float p = pow(max(e, 0.0), ${glsl(1 / PQ_M2)});
  return pow(max(p - ${glsl(PQ_C1)}, 0.0) / (${glsl(PQ_C2)} - ${glsl(PQ_C3)} * p), ${glsl(1 / PQ_M1)});
}`
      : `float invTransfer(float e) {
  return e <= 0.5 ? (e * e) / 3.0 : (exp((e - ${glsl(HLG_C)}) / ${glsl(HLG_A)}) + ${glsl(HLG_B)}) / 12.0;
}`;

  const ootf =
    transfer === "hlg"
      ? `  float ys = max(dot(lin, LUMA_2020), 1e-6);
  lin *= pow(ys, ${glsl(HLG_GAMMA - 1)});`
      : "";

  const operator =
    toneMap === "hable"
      ? `float mapSig(float x) { return hable(x) / hable(${glsl(HABLE_W)}); }`
      : `float mapSig(float x) { return x / (x + ${glsl(REINHARD_PARAM)}) * ${glsl(
          (PEAK[transfer] + REINHARD_PARAM) / PEAK[transfer],
        )}; }`;

  const tonemapBlock =
    toneMap === "none"
      ? ""
      : `  float luma = dot(lin, LUMA_2020);
  float overbright = max(luma - ${glsl(DESAT)}, 1e-6) / max(luma, 1e-6);
  lin += (vec3(luma) - lin) * overbright;
  float sig = max(max(lin.r, lin.g), max(lin.b, 1e-6));
  lin *= mapSig(sig) / sig;`;

  // GLSL mat3 constructors are column-major.
  const m = M_2020_TO_709;
  const matrix = `mat3(${glsl(m[0][0])}, ${glsl(m[1][0])}, ${glsl(m[2][0])}, ${glsl(
    m[0][1],
  )}, ${glsl(m[1][1])}, ${glsl(m[2][1])}, ${glsl(m[0][2])}, ${glsl(m[1][2])}, ${glsl(m[2][2])})`;

  return `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uExposureGain;
uniform float uContrast;
uniform float uSaturation;
in vec2 vTex;
out vec4 outColor;

const vec3 LUMA_2020 = vec3(${glsl(LUMA_2020[0])}, ${glsl(LUMA_2020[1])}, ${glsl(LUMA_2020[2])});
const vec3 LUMA_709 = vec3(${glsl(LUMA_709[0])}, ${glsl(LUMA_709[1])}, ${glsl(LUMA_709[2])});
const mat3 M_2020_TO_709 = ${matrix};

${invTransfer}

float hable(float x) {
  return (x * (${glsl(HABLE_A)} * x + ${glsl(HABLE_C * HABLE_B)}) + ${glsl(HABLE_D * HABLE_E)})
       / (x * (${glsl(HABLE_A)} * x + ${glsl(HABLE_B)}) + ${glsl(HABLE_D * HABLE_F)})
       - ${glsl(HABLE_E / HABLE_F)};
}
${operator}

float oetf709(float l) {
  return l < 0.018 ? 4.5 * l : 1.099 * pow(l, 0.45) - 0.099;
}

void main() {
  vec3 sig3 = clamp(texture(uTex, vTex).rgb, 0.0, 1.0);
  vec3 lin = vec3(invTransfer(sig3.r), invTransfer(sig3.g), invTransfer(sig3.b));
${ootf}
  lin *= ${glsl(NPL_SCALE[transfer])} * uExposureGain;
${tonemapBlock}
  vec3 rgb = clamp(M_2020_TO_709 * lin, 0.0, 1.0);
  vec3 enc = vec3(oetf709(rgb.r), oetf709(rgb.g), oetf709(rgb.b));
  enc = clamp((enc - 0.5) * uContrast + 0.5, 0.0, 1.0);
  float y = dot(enc, LUMA_709);
  outColor = vec4(clamp(vec3(y) + (enc - vec3(y)) * uSaturation, 0.0, 1.0), 1.0);
}
`;
}

/**
 * Pass-A fragment shader: raw YUV plane textures → non-linear R'G'B' signal,
 * written to a full-resolution framebuffer that the tone-map pass then
 * samples. Implements {@link yuvPixelToRgb} + {@link chromaSamplePlanar} with
 * the same constants; the per-export ground-truth check compares the two.
 *
 * Planes arrive as R8/RG8 (8-bit) or R16UI (10/12-bit, code values in the low
 * bits) textures; `texelFetch` everywhere, so filtering state is irrelevant.
 * The shader addresses pixels via gl_FragCoord: framebuffer texel (x, y) is
 * source pixel (x, y), which keeps pass B's texture conventions identical to
 * the old direct-upload path (row 0 at v = 0).
 */
export function yuvFragmentShaderSource(opts: {
  layout: YuvLayout;
  chroma: ChromaLayout;
}): string {
  const k = yuvToRgbCoefficients(opts.layout);
  const sixteen = opts.layout.bitDepth > 8;
  const sampler = sixteen ? "usampler2D" : "sampler2D";
  // R8 texels are UNORM (v/255); R16UI texels are the raw integer code value.
  const yCode = sixteen
    ? "float(texelFetch(uY, pos, 0).r)"
    : "texelFetch(uY, pos, 0).r * 255.0";
  const cAt =
    opts.chroma === "nv12"
      ? "vec2 cAt(ivec2 p) { return vec2(texelFetch(uC1, p, 0).rg) * 255.0; }"
      : sixteen
        ? `vec2 cAt(ivec2 p) { return vec2(float(texelFetch(uC1, p, 0).r), float(texelFetch(uC2, p, 0).r)); }`
        : `vec2 cAt(ivec2 p) { return vec2(texelFetch(uC1, p, 0).r, texelFetch(uC2, p, 0).r) * 255.0; }`;

  let chromaSample: string;
  switch (opts.chroma) {
    case "i444":
      chromaSample = "  vec2 c = cAt(pos);";
      break;
    case "i422":
      chromaSample = `  ivec2 cSize = textureSize(uC1, 0);
  vec3 ax = axisWeights(float(pos.x), cSize.x);
  vec2 c = mix(cAt(ivec2(int(ax.x), pos.y)), cAt(ivec2(int(ax.y), pos.y)), ax.z);`;
      break;
    default: // i420, nv12 — subsampled on both axes
      chromaSample = `  ivec2 cSize = textureSize(uC1, 0);
  vec3 ax = axisWeights(float(pos.x), cSize.x);
  vec3 ay = axisWeights(float(pos.y), cSize.y);
  vec2 top = mix(cAt(ivec2(int(ax.x), int(ay.x))), cAt(ivec2(int(ax.y), int(ay.x))), ax.z);
  vec2 bottom = mix(cAt(ivec2(int(ax.x), int(ay.y))), cAt(ivec2(int(ax.y), int(ay.y))), ax.z);
  vec2 c = mix(top, bottom, ay.z);`;
      break;
  }

  return `#version 300 es
precision highp float;
precision highp int;
precision highp ${sampler};
uniform ${sampler} uY;
uniform ${sampler === "usampler2D" && opts.chroma === "nv12" ? "sampler2D" : sampler} uC1;
uniform ${sampler} uC2;
out vec4 outColor;

${cAt}

// Centred chroma siting: (a, b, t) = the two clamped sample indices and the
// bilinear weight for one axis. Mirrors chromaSamplePlanar in tonemap.ts.
vec3 axisWeights(float v, int size) {
  float f = v * 0.5 - 0.25;
  float i0 = floor(f);
  float t = f - i0;
  float a = clamp(i0, 0.0, float(size - 1));
  float b = clamp(i0 + 1.0, 0.0, float(size - 1));
  return vec3(a, b, t);
}

void main() {
  ivec2 pos = ivec2(gl_FragCoord.xy);
  float yv = (${yCode} - ${glsl(k.yOffset)}) * ${glsl(k.yScale)};
${chromaSample}
  float cb = (c.x - ${glsl(k.cOffset)}) * ${glsl(k.cScale)};
  float cr = (c.y - ${glsl(k.cOffset)}) * ${glsl(k.cScale)};
  vec3 rgb = vec3(
    yv + ${glsl(k.rCr)} * cr,
    yv + ${glsl(k.gCb)} * cb + ${glsl(k.gCr)} * cr,
    yv + ${glsl(k.bCb)} * cb
  );
  outColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;
}
