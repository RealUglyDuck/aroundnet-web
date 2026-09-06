import assert from "node:assert/strict";
import { fingerprintVideo } from "./fingerprint.ts";

const CHUNK = 1024 * 1024;

/** A File standing in for a picked video, filled with a repeatable pattern. */
function fakeFile(name: string, bytes: Uint8Array): File {
  return new File([bytes as unknown as BlobPart], name, { type: "video/mp4" });
}

function pattern(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size);
  // A cheap LCG — deterministic, and unlike a constant fill it gives the head
  // and tail different content, which is what the tail assertions rely on.
  let x = seed;
  for (let i = 0; i < size; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out[i] = x & 0xff;
  }
  return out;
}

// 1. Identical bytes hash identically, and it is a SHA-256 hex string.
{
  const bytes = pattern(3 * CHUNK);
  const a = await fingerprintVideo(fakeFile("clip.mp4", bytes));
  const b = await fingerprintVideo(fakeFile("clip.mp4", bytes));
  assert.equal(a, b, "same bytes, same fingerprint");
  assert.match(a, /^[0-9a-f]{64}$/, "hex SHA-256");
  console.log("✓ stable across calls");
}

// 2. Renaming must not change it — the whole reason this hashes content.
{
  const bytes = pattern(3 * CHUNK);
  const a = await fingerprintVideo(fakeFile("serve-drill.mp4", bytes));
  const b = await fingerprintVideo(fakeFile("renamed on disk.MP4", bytes));
  assert.equal(a, b, "a rename keeps the fingerprint");
  console.log("✓ survives a rename");
}

// 3. A byte flipped in the TAIL changes it. This is the case a head-only hash
// would miss, and it is the common one: iPhone MP4s carry `moov` at the end.
{
  const bytes = pattern(3 * CHUNK);
  const edited = bytes.slice();
  edited[edited.length - 42] ^= 0xff;
  const a = await fingerprintVideo(fakeFile("clip.mp4", bytes));
  const b = await fingerprintVideo(fakeFile("clip.mp4", edited));
  assert.notEqual(a, b, "a changed tail byte changes the fingerprint");
  console.log("✓ detects a tail edit");
}

// 4. And in the head.
{
  const bytes = pattern(3 * CHUNK);
  const edited = bytes.slice();
  edited[7] ^= 0xff;
  const a = await fingerprintVideo(fakeFile("clip.mp4", bytes));
  const b = await fingerprintVideo(fakeFile("clip.mp4", edited));
  assert.notEqual(a, b, "a changed head byte changes the fingerprint");
  console.log("✓ detects a head edit");
}

// 5. Two files that share their outer 2 MiB but differ in length must not
// collide — this is what mixing the size into the payload buys.
{
  const base = pattern(3 * CHUNK);
  const longer = new Uint8Array(base.length + CHUNK);
  longer.set(base.subarray(0, CHUNK), 0);
  longer.set(base.subarray(base.length - CHUNK), longer.length - CHUNK);
  const a = await fingerprintVideo(fakeFile("clip.mp4", base));
  const b = await fingerprintVideo(fakeFile("clip.mp4", longer));
  assert.notEqual(a, b, "same ends but a different length must differ");
  console.log("✓ size participates in the hash");
}

// 6. Small files still hash — the slices would overlap, so the tail is skipped.
{
  const small = pattern(1024);
  const a = await fingerprintVideo(fakeFile("tiny.mp4", small));
  assert.match(a, /^[0-9a-f]{64}$/, "a sub-chunk file hashes");
  const other = pattern(1024, 99);
  const b = await fingerprintVideo(fakeFile("tiny.mp4", other));
  assert.notEqual(a, b, "two small files still separate");
  // And an empty file must not throw.
  assert.match(
    await fingerprintVideo(fakeFile("empty.mp4", new Uint8Array(0))),
    /^[0-9a-f]{64}$/,
    "an empty file hashes rather than throwing",
  );
  console.log("✓ small and empty files");
}

console.log("all fingerprint tests passed");
