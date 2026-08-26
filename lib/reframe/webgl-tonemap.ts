/**
 * WebGL2 plumbing for the export tone map.
 *
 * The browser tone-maps HDR frames on every image-shaped route to the GPU —
 * `texImage2D(videoFrame)` converts into the context's `unpackColorSpace`
 * (srgb/display-p3 only) by spec, `drawImage` converts, and
 * `copyTo({format:"RGBA"})` is defined as canvas-equivalent. The one
 * untouched transport is `VideoFrame.copyTo()` with no format option: raw
 * YUV planes. So this renderer never uploads a frame object; it uploads the
 * planes and rebuilds the signal itself, in two passes:
 *
 *   pass A: plane textures → range expansion + YUV→RGB → full-res RGBA16F
 *           framebuffer holding the non-linear R'G'B' *signal*;
 *   pass B: the tone-map program (unchanged) samples that framebuffer with
 *           hardware bilinear through the crop matrix.
 *
 * Trust is earned per export, not assumed: `verifyAgainstReference` compares
 * GPU pass-A output against the TypeScript maths for scattered texels of the
 * first real frame, and the caller falls back to the 2D path if the numbers
 * disagree. (The previous texImage2D design was gated by a "differs from the
 * 2D path" heuristic, which false-passed; only ground truth is trusted now.)
 *
 * Colour math lives in tonemap.ts — this file never invents constants.
 */

import type { ReframeGrade } from "./model.ts";
import {
  VERTEX_SHADER_SOURCE,
  chromaSamplePlanar,
  fragmentShaderSource,
  planeDimensions,
  tonemapPixel,
  yuvFragmentShaderSource,
  yuvPixelToRgb,
  type PixelFormatDesc,
  type SourceTransfer,
  type YuvLayout,
} from "./tonemap.ts";

export const IDENTITY_TEX_MATRIX: ReadonlyArray<number> = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** One frame's colour planes, as views over the copyTo buffer. */
export interface PlaneData {
  /** Per colour plane (alpha excluded). Uint16Array for 10/12-bit planes. */
  views: Array<Uint8Array | Uint16Array>;
  /** Row length in *texels* for each plane (stride ÷ bytes-per-texel). */
  rowLengths: number[];
}

interface ProgramInfo {
  program: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

function compileProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  uniformNames: string[],
): ProgramInfo | null {
  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("reframe shader compile failed:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("reframe shader link failed:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  const u: Record<string, WebGLUniformLocation | null> = {};
  for (const name of uniformNames) u[name] = gl.getUniformLocation(program, name);
  return { program, u };
}

const TONE_UNIFORMS = ["uTexMatrix", "uTex", "uExposureGain", "uContrast", "uSaturation"];
const PASS_A_UNIFORMS = ["uTexMatrix", "uY", "uC1", "uC2"];

export class WebglToneMap {
  readonly canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private tone: ProgramInfo;
  /** Scratch texture for the ramp self-test. */
  private scratchTex: WebGLTexture;
  private scratchHalfFloat = true;
  /** Whether the pass-A framebuffer could be RGBA16F (else RGBA8 + banding risk). */
  fboFloat: boolean;

  // Configured by configureSource:
  private passA: ProgramInfo | null = null;
  private planeTex: WebGLTexture[] = [];
  private fbo: WebGLFramebuffer | null = null;
  private fboTex: WebGLTexture | null = null;
  private frameWidth = 0;
  private frameHeight = 0;
  private desc: PixelFormatDesc | null = null;
  private layout: YuvLayout | null = null;

  private constructor(
    canvas: OffscreenCanvas,
    gl: WebGL2RenderingContext,
    tone: ProgramInfo,
    scratchTex: WebGLTexture,
    fboFloat: boolean,
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.tone = tone;
    this.scratchTex = scratchTex;
    this.fboFloat = fboFloat;
  }

  /** Returns null when WebGL2 is unavailable or the tone shader won't compile. */
  static create(opts: {
    transfer: SourceTransfer;
    toneMap: ReframeGrade["toneMap"];
  }): WebglToneMap | null {
    if (typeof OffscreenCanvas === "undefined") return null;
    const canvas = new OffscreenCanvas(2, 2);
    // preserveDrawingBuffer: the muxer's CanvasSource snapshots the canvas
    // synchronously, but the cost is negligible and the failure mode of a
    // cleared buffer is a silent black export.
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) return null;

    const tone = compileProgram(
      gl,
      VERTEX_SHADER_SOURCE,
      fragmentShaderSource({ transfer: opts.transfer, toneMap: opts.toneMap }),
      TONE_UNIFORMS,
    );
    const scratchTex = gl.createTexture();
    if (!tone || !scratchTex) return null;

    // One fullscreen quad, forever.
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    // Rendering to RGBA16F needs one of these; universally present in
    // practice, but the RGBA8 fallback keeps colour correct either way.
    const fboFloat =
      gl.getExtension("EXT_color_buffer_float") !== null ||
      gl.getExtension("EXT_color_buffer_half_float") !== null;

    return new WebglToneMap(canvas, gl, tone, scratchTex, fboFloat);
  }

  private static configureTexture(gl: WebGL2RenderingContext, tex: WebGLTexture): void {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Integer textures reject LINEAR; pass A texelFetches everything anyway.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  /**
   * Compile the pass-A program for one source format and build the plane
   * textures and framebuffer. Returns false if anything refuses.
   */
  configureSource(desc: PixelFormatDesc, layout: YuvLayout, width: number, height: number): boolean {
    const gl = this.gl;
    this.desc = desc;
    this.layout = layout;
    this.frameWidth = width;
    this.frameHeight = height;

    this.passA = compileProgram(
      gl,
      VERTEX_SHADER_SOURCE,
      yuvFragmentShaderSource({ layout, chroma: desc.chroma }),
      PASS_A_UNIFORMS,
    );
    if (!this.passA) return false;

    const planes = planeDimensions(desc, width, height);
    this.planeTex = planes.map(() => {
      const tex = gl.createTexture();
      WebglToneMap.configureTexture(gl, tex);
      return tex;
    });

    const fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Pass B downsamples this by up to ~2×, so it must be filterable —
    // RGBA16F is, in core WebGL2.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.fboFloat ? gl.RGBA16F : gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      this.fboFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      null,
    );
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete && this.fboFloat) {
      // Odd driver: retry as RGBA8 before giving up.
      this.fboFloat = false;
      return this.configureSource(desc, layout, width, height);
    }
    if (!complete) return false;
    this.fboTex = fboTex;
    this.fbo = fbo;
    return true;
  }

  private uploadPlanes(data: PlaneData): void {
    const gl = this.gl;
    const desc = this.desc;
    if (!desc) throw new Error("configureSource was not called.");
    const sixteen = desc.bitDepth > 8;
    const planes = planeDimensions(desc, this.frameWidth, this.frameHeight);
    for (let i = 0; i < planes.length; i++) {
      const dim = planes[i];
      gl.bindTexture(gl.TEXTURE_2D, this.planeTex[i]);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, data.rowLengths[i]);
      if (sixteen) {
        gl.texImage2D(
          gl.TEXTURE_2D, 0, gl.R16UI, dim.width, dim.height, 0,
          gl.RED_INTEGER, gl.UNSIGNED_SHORT, data.views[i] as Uint16Array,
        );
      } else if (dim.samplesPerPixel === 2) {
        gl.texImage2D(
          gl.TEXTURE_2D, 0, gl.RG8, dim.width, dim.height, 0,
          gl.RG, gl.UNSIGNED_BYTE, data.views[i] as Uint8Array,
        );
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D, 0, gl.R8, dim.width, dim.height, 0,
          gl.RED, gl.UNSIGNED_BYTE, data.views[i] as Uint8Array,
        );
      }
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  }

  private runPassA(): void {
    const gl = this.gl;
    const passA = this.passA;
    if (!passA || !this.fbo) throw new Error("configureSource was not called.");
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.frameWidth, this.frameHeight);
    gl.useProgram(passA.program);
    // The vertex shader wants a matrix even though pass A only reads
    // gl_FragCoord; identity keeps the quad covering the viewport.
    gl.uniformMatrix3fv(passA.u.uTexMatrix, false, IDENTITY_TEX_MATRIX as number[]);
    for (let i = 0; i < this.planeTex.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.planeTex[i]);
    }
    gl.uniform1i(passA.u.uY, 0);
    gl.uniform1i(passA.u.uC1, 1);
    if (passA.u.uC2) gl.uniform1i(passA.u.uC2, 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  private drawTone(texture: WebGLTexture, matrix: ReadonlyArray<number>, grade: ReframeGrade): void {
    const gl = this.gl;
    gl.useProgram(this.tone.program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniformMatrix3fv(this.tone.u.uTexMatrix, false, matrix as number[]);
    gl.uniform1f(this.tone.u.uExposureGain, Math.pow(2, grade.exposure));
    gl.uniform1f(this.tone.u.uContrast, grade.contrast);
    gl.uniform1f(this.tone.u.uSaturation, grade.saturation);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.tone.u.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** The export path: planes in, tone-mapped crop on the canvas out. */
  renderPlanes(data: PlaneData, matrix: ReadonlyArray<number>, grade: ReframeGrade): void {
    if (!this.fboTex) throw new Error("configureSource was not called.");
    this.uploadPlanes(data);
    this.runPassA();
    this.drawTone(this.fboTex, matrix, grade);
  }

  /**
   * The gate for the whole raw-plane path: run pass A on a real frame's
   * planes and compare scattered texels against the TypeScript reference
   * (`yuvPixelToRgb` + the shared chroma bilinear). The point set is
   * asymmetric on purpose — any flip, transpose or stride slip fails loudly
   * instead of averaging out.
   */
  verifyAgainstReference(data: PlaneData): { ok: boolean; maxError: number; detail: string } {
    const gl = this.gl;
    const desc = this.desc;
    const layout = this.layout;
    if (!desc || !layout || !this.fbo) throw new Error("configureSource was not called.");

    this.uploadPlanes(data);
    this.runPassA();

    const w = this.frameWidth;
    const h = this.frameHeight;
    const planes = planeDimensions(desc, w, h);
    const at = (plane: number, x: number, y: number): number => {
      const view = data.views[plane];
      const rl = data.rowLengths[plane];
      return planes[plane].samplesPerPixel === 2 ? view[(y * rl + x) * 2] : view[y * rl + x];
    };
    const cbAt =
      desc.chroma === "nv12"
        ? (x: number, y: number) => data.views[1][(y * data.rowLengths[1] + x) * 2]
        : (x: number, y: number) => at(1, x, y);
    const crAt =
      desc.chroma === "nv12"
        ? (x: number, y: number) => data.views[1][(y * data.rowLengths[1] + x) * 2 + 1]
        : (x: number, y: number) => at(2, x, y);
    const cw = planes[1].width;
    const ch = planes[1].height;

    // Deterministic scatter plus three deliberately asymmetric anchors.
    const points: Array<[number, number]> = [
      [1, 1],
      [w - 2, 2],
      [2, h - 2],
    ];
    for (let i = 0; i < 45; i++) {
      points.push([
        Math.min(w - 1, Math.floor(w * (((i * 0.371) + 0.05) % 1))),
        Math.min(h - 1, Math.floor(h * (((i * 0.617) + 0.11) % 1))),
      ]);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    const floatBuf = new Float32Array(4);
    const byteBuf = new Uint8Array(4);
    let maxError = 0;
    for (const [x, y] of points) {
      let actual: [number, number, number];
      if (this.fboFloat) {
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, floatBuf);
        actual = [floatBuf[0], floatBuf[1], floatBuf[2]];
      } else {
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, byteBuf);
        actual = [byteBuf[0] / 255, byteBuf[1] / 255, byteBuf[2] / 255];
      }
      const yCode = at(0, x, y);
      const cb = chromaSamplePlanar(cbAt, cw, ch, x, y, desc.chroma);
      const cr = chromaSamplePlanar(crAt, cw, ch, x, y, desc.chroma);
      const expected = yuvPixelToRgb(yCode, cb, cr, layout);
      for (let c = 0; c < 3; c++) {
        maxError = Math.max(maxError, Math.abs(actual[c] - expected[c]) * 255);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const ok = maxError <= 3;
    return {
      ok,
      maxError,
      detail: `${ok ? "GPU YUV pass matches the TypeScript reference" : "GPU YUV pass DISAGREES with the reference"} (max error ${maxError.toFixed(2)}/255 over ${points.length} texels, ${this.fboFloat ? "RGBA16F" : "RGBA8"} framebuffer)`,
    };
  }

  setSize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /** readPixels of the drawing buffer, rows reordered top-down. */
  private readCanvasTopDown(width: number, height: number): Uint8Array {
    const gl = this.gl;
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const out = new Uint8Array(raw.length);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      out.set(raw.subarray(y * rowBytes, (y + 1) * rowBytes), (height - 1 - y) * rowBytes);
    }
    return out;
  }

  /**
   * GPU-vs-reference self-test for pass B: run the real compiled tone-map
   * program over a ramp of known signal values (raw ArrayBufferView uploads
   * are never colour-converted, so this stays trustworthy) and compare every
   * sample against {@link tonemapPixel}. Proves the GLSL and the TypeScript
   * are the same function on the real GPU.
   */
  selfTest(opts: { transfer: SourceTransfer; grade: ReframeGrade }): {
    ok: boolean;
    maxError: number;
    detail: string;
  } {
    const gl = this.gl;
    const W = 256;
    const H = 2;
    // Row 0: grey ramp. Row 1: a chromatic sweep, which exercises the OOTF
    // luminance, desat, max-channel and gamut stages a grey ramp cannot.
    const signalAt = (x: number, row: number): [number, number, number] =>
      row === 0 ? [x / 255, x / 255, x / 255] : [x / 255, 1 - x / 255, 0.5];

    WebglToneMap.configureTexture(gl, this.scratchTex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    let quantised = false;
    if (this.scratchHalfFloat) {
      const data = new Float32Array(W * H * 4);
      for (let row = 0; row < H; row++) {
        for (let x = 0; x < W; x++) {
          const [r, g, b] = signalAt(x, row);
          data.set([r, g, b, 1], (row * W + x) * 4);
        }
      }
      gl.getError();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, W, H, 0, gl.RGBA, gl.FLOAT, data);
      if (gl.getError() !== gl.NO_ERROR) this.scratchHalfFloat = false;
    }
    if (!this.scratchHalfFloat) {
      quantised = true;
      const data = new Uint8Array(W * H * 4);
      for (let row = 0; row < H; row++) {
        for (let x = 0; x < W; x++) {
          const [r, g, b] = signalAt(x, row);
          data.set([r * 255, g * 255, b * 255, 255], (row * W + x) * 4);
        }
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    // Only sample level 0 — the scratch texture has no mip chain.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.setSize(W, H);
    this.drawTone(this.scratchTex, IDENTITY_TEX_MATRIX, opts.grade);
    const px = this.readCanvasTopDown(W, H);

    let maxError = 0;
    for (let row = 0; row < H; row++) {
      for (let x = 0; x < W; x++) {
        let signal = signalAt(x, row);
        if (quantised) {
          signal = signal.map((v) => Math.round(v * 255) / 255) as [number, number, number];
        }
        const expected = tonemapPixel(signal, { transfer: opts.transfer, grade: opts.grade });
        const base = (row * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          maxError = Math.max(maxError, Math.abs(px[base + c] - expected[c] * 255));
        }
      }
    }
    const ok = maxError <= 3;
    return {
      ok,
      maxError,
      detail: `${ok ? "GPU matches the TypeScript reference" : "GPU DISAGREES with the reference"} (max error ${maxError.toFixed(2)}/255, ${quantised ? "RGBA8" : "RGBA16F"})`,
    };
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.tone.program);
    if (this.passA) gl.deleteProgram(this.passA.program);
    gl.deleteTexture(this.scratchTex);
    for (const tex of this.planeTex) gl.deleteTexture(tex);
    if (this.fboTex) gl.deleteTexture(this.fboTex);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
