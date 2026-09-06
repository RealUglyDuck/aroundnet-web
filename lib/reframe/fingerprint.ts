/**
 * A stable identity for a picked video file, so an edit made today can be found
 * again tomorrow.
 *
 * A browser cannot re-open a local file on its own and a `File` carries no id,
 * so the only durable handle is the content itself. This hashes the file's
 * SIZE plus its first and last 1 MiB rather than the whole thing:
 *
 *   * Content, not name — a renamed or re-copied clip still finds its document.
 *     `name` and `lastModified` both change under ordinary handling (AirDrop,
 *     iCloud, a tidy-up rename) and would strand the work.
 *   * Ends, not everything — a 4 GB recording costs one 2 MiB read instead of a
 *     full pass. Head AND tail matters for MP4 specifically: iPhone footage puts
 *     `moov` at the end, so the tail is where much of the distinguishing
 *     structure lives.
 *
 * Two different files colliding is not a practical concern, and the failure
 * mode either way is mild: a miss just means the editor opens a blank document,
 * which is what it did before any of this existed.
 *
 * Deliberately NOT in model.ts — that module is the DOM-free, dependency-free
 * contract shared with the Swift port, and `File`/`crypto.subtle` would break it.
 */

/** Bytes taken from each end. */
const CHUNK = 1024 * 1024;

/**
 * A hex SHA-256 over the file's size and its outer bytes.
 *
 * Falls back to a plain `name:size` string where `crypto.subtle` is missing —
 * it needs a secure context, which localhost and the production origin both
 * satisfy, but this is a convenience feature and must never be the reason a
 * clip won't open.
 */
export async function fingerprintVideo(file: File): Promise<string> {
  const head = await file.slice(0, Math.min(CHUNK, file.size)).arrayBuffer();
  // Files of 2 MiB or less are read once, whole: the two slices would overlap
  // and hashing the same bytes twice buys nothing.
  const tail =
    file.size > CHUNK * 2
      ? await file.slice(file.size - CHUNK).arrayBuffer()
      : new ArrayBuffer(0);

  const payload = new Uint8Array(8 + head.byteLength + tail.byteLength);
  // Size goes in first, so two clips sharing a head and tail (a re-encode
  // truncated mid-file, say) still separate.
  new DataView(payload.buffer).setFloat64(0, file.size);
  payload.set(new Uint8Array(head), 8);
  payload.set(new Uint8Array(tail), 8 + head.byteLength);

  if (!globalThis.crypto?.subtle) return `${file.name}:${file.size}`;
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
