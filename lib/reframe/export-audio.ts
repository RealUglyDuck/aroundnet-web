/**
 * Audio for the reframe exporter, in two strategies.
 *
 * A single contiguous range can copy its encoded packets straight across —
 * free, lossless, and what the exporter has always done. A reel cannot: AAC
 * packets are ~21ms and do not align to segment boundaries, `EncodedPacket`
 * can be re-timed but not shortened, and the leftover fractional packet at
 * each join is exactly the click you would hear. So stitched output is decoded
 * and re-encoded, trimmed to the frame.
 */

import {
  AudioSampleSink,
  AudioSampleSource,
  EncodedPacketSink,
  QUALITY_MEDIUM,
  canEncodeAudio,
  type AudioCodec,
  type EncodedAudioPacketSource,
  type InputAudioTrack,
} from "mediabunny";

export interface ExportRange {
  start: number;
  end: number;
}

export type AudioPlan =
  | { kind: "none"; reason?: string }
  | { kind: "copy"; codec: AudioCodec }
  | { kind: "reencode" };

/** Decide which audio strategy an export can use, if any. */
export async function planAudio(
  audioTrack: InputAudioTrack | null,
  supportedCodecs: readonly string[],
  rangeCount: number,
): Promise<AudioPlan> {
  if (!audioTrack) return { kind: "none" };

  const codec = await audioTrack.getCodec();
  if (rangeCount <= 1) {
    // Straight copy needs the source codec to be legal inside MP4 — Opus in a
    // WebM is dropped rather than silently transcoded.
    if (codec && supportedCodecs.includes(codec)) return { kind: "copy", codec };
    return { kind: "none", reason: `Audio codec ${codec ?? "unknown"} can't go in an MP4.` };
  }

  if (!(await audioTrack.canDecode())) {
    return { kind: "none", reason: "This browser can't decode the source audio." };
  }
  const [channels, sampleRate] = await Promise.all([
    audioTrack.getNumberOfChannels(),
    audioTrack.getSampleRate(),
  ]);
  if (!(await canEncodeAudio("aac", { numberOfChannels: channels, sampleRate }))) {
    return { kind: "none", reason: "This browser can't encode AAC, so the reel is silent." };
  }
  return { kind: "reencode" };
}

export function createReelAudioSource(): AudioSampleSource {
  return new AudioSampleSource({ codec: "aac", quality: QUALITY_MEDIUM });
}

/** One contiguous range: copy the encoded packets, rebased to start at zero. */
export async function copyAudioPackets(opts: {
  audioTrack: InputAudioTrack;
  audioSource: EncodedAudioPacketSource;
  range: ExportRange;
  /** Subtracted from every timestamp; shared with the video track. */
  timeOffset: number;
  throwIfAborted: () => void;
}): Promise<void> {
  const { audioTrack, audioSource, range, timeOffset, throwIfAborted } = opts;

  const decoderConfig = await audioTrack.getDecoderConfig();
  if (!decoderConfig) throw new Error("Could not read the audio decoder config.");

  const packetSink = new EncodedPacketSink(audioTrack);
  // Start from the key packet at or before the in-point so the decoder has
  // everything it needs; packets ending before it are dropped below.
  const startPacket = await packetSink.getKeyPacket(range.start);
  let isFirst = true;

  for await (const packet of packetSink.packets(startPacket ?? undefined)) {
    throwIfAborted();
    if (packet.timestamp >= range.end) break;
    if (packet.timestamp + packet.duration <= timeOffset) continue;
    // A packet straddling the in-point is kept but pinned to zero rather than
    // going negative, which the muxer rejects.
    const shifted = Math.max(0, packet.timestamp - timeOffset);
    await audioSource.add(
      shifted === packet.timestamp ? packet : packet.clone({ timestamp: shifted }),
      isFirst ? { decoderConfig } : undefined,
    );
    isFirst = false;
  }
}

/**
 * Many ranges: decode, trim to the frame, and re-encode as one continuous
 * track.
 *
 * Output timestamps come from a running frame counter rather than from the
 * source, so they are contiguous by construction and the first is exactly
 * zero. At every join the counter is re-locked to the video's output offset:
 * delivered audio can be a fraction of a frame short of a segment's nominal
 * duration, and without reconciliation ten joins compound into audible
 * lip-sync error.
 */
export async function encodeAudioReel(opts: {
  audioTrack: InputAudioTrack;
  audioSource: AudioSampleSource;
  ranges: ExportRange[];
  throwIfAborted: () => void;
}): Promise<void> {
  const { audioTrack, audioSource, ranges, throwIfAborted } = opts;

  const sampleRate = await audioTrack.getSampleRate();
  const sink = new AudioSampleSink(audioTrack);
  let writtenFrames = 0;
  let outOffset = 0;

  for (const range of ranges) {
    const desiredFrame = Math.round(outOffset * sampleRate);
    // Audio ran long: trim the head of this range. Never nudge a timestamp
    // backwards instead — mediabunny pads gaps but its own source notes that
    // overlapping samples are undefined behaviour.
    let headDrop = Math.max(0, writtenFrames - desiredFrame);
    // Audio ran short: skip forward and let the encoder pad the gap.
    if (writtenFrames < desiredFrame) writtenFrames = desiredFrame;

    for await (const sample of sink.samples(range.start, range.end)) {
      throwIfAborted();
      try {
        // The sink yields the sample *covering* range.start, so its leading
        // frames belong to the previous segment and must be cut.
        let lo = Math.max(0, Math.round((range.start - sample.timestamp) * sampleRate));
        const hi = Math.min(
          sample.numberOfFrames,
          Math.round((range.end - sample.timestamp) * sampleRate),
        );
        lo += headDrop;
        headDrop = 0;
        if (hi <= lo) continue;

        const piece = lo === 0 && hi === sample.numberOfFrames ? sample : sample.trim(lo, hi);
        try {
          piece.setTimestamp(writtenFrames / sampleRate);
          await audioSource.add(piece);
          writtenFrames += piece.numberOfFrames;
        } finally {
          if (piece !== sample) piece.close();
        }
      } finally {
        sample.close();
      }
    }
    outOffset += range.end - range.start;
  }
}
