/** Display helpers for the reframe editor. */

/**
 * `1:05.2`, or `1:05:14` (with a frame number) when a frame rate is known.
 * Frame-accurate labels matter here: a keyframe is pinned to a frame, not to
 * an approximate second.
 */
export function formatTimecode(seconds: number, frameRate?: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const mm = `${mins}`.padStart(2, "0");
  const ss = `${secs}`.padStart(2, "0");

  if (frameRate && frameRate > 0) {
    const frame = Math.floor((safe % 1) * frameRate);
    return `${mm}:${ss}:${`${frame}`.padStart(2, "0")}`;
  }
  return `${mm}:${ss}.${Math.floor((safe % 1) * 10)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
