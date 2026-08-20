/**
 * Reads the metadata the editor needs out of a user-picked video file.
 *
 * The `<video>` element could supply dimensions and duration, but not a
 * reliable frame rate, and its `videoWidth` handling of rotated footage
 * varies. mediabunny reads the container directly and derives frame rate from
 * actual packet timestamps, so it is the authority for everything the crop
 * math depends on.
 */

import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import type { ReframeSource } from "./model.ts";

export class UnsupportedVideoError extends Error {}

export async function probeVideo(file: File): Promise<ReframeSource> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new UnsupportedVideoError("That file has no video track.");
    if (!(await track.canDecode())) {
      const codec = await track.getCodec();
      throw new UnsupportedVideoError(
        `This browser can't decode the video codec${codec ? ` (${codec})` : ""}.`,
      );
    }

    const [width, height, duration] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      input.computeDuration(),
    ]);

    // Sampling ~120 packets is enough for a stable average without walking
    // the whole file; variable-frame-rate footage just gets its mean rate.
    let frameRate: number | undefined;
    try {
      const stats = await track.computePacketStats(120);
      if (stats.averagePacketRate > 0) frameRate = stats.averagePacketRate;
    } catch {
      // Frame rate is a nicety (frame-step size, export hint) — not fatal.
    }

    // Colour is informational, but it is the first thing to check when an
    // export looks washed out: everything goes through an sRGB 2D canvas, so
    // a wide-gamut or HDR source is converted on the way through.
    let colorSpace: string | undefined;
    let hdr: boolean | undefined;
    try {
      const cs = await track.getColorSpace();
      const parts = [cs.primaries, cs.transfer, cs.matrix].filter(Boolean);
      const range = cs.fullRange === true ? " / full" : cs.fullRange === false ? " / limited" : "";
      colorSpace = parts.length ? `${parts.join(" / ")}${range}` : undefined;
      hdr = await track.hasHighDynamicRange();
    } catch {
      // Not every container reports colour; this is a diagnostic, not a
      // requirement.
    }

    return { width, height, duration, name: file.name, frameRate, colorSpace, hdr };
  } finally {
    input.dispose();
  }
}
