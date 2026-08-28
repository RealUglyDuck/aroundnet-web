"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  TARGET_PRESETS,
  findTargetPreset,
  totalSegmentDuration,
  type ReframeDoc,
  type TargetSize,
} from "@/lib/reframe/model";
import {
  ExportCanceledError,
  exportReframedVideo,
  suggestedFilename,
  type ExportProgress,
  type ExportQuality,
} from "@/lib/reframe/export";
import { maxCropExtent } from "@/lib/reframe/solve";
import { formatBytes, formatTimecode } from "@/lib/reframe/format";

interface Props {
  doc: ReframeDoc;
  file: File;
  quality: ExportQuality;
  includeAudio: boolean;
  /** Why this browser can't export at all, if it can't. */
  unsupportedReason?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetTarget: (target: { width: number; height: number }) => void;
  onSetQuality: (quality: ExportQuality) => void;
  onSetIncludeAudio: (include: boolean) => void;
}

const QUALITY_LABELS: Record<ExportQuality, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  veryHigh: "Very high",
};

const STAGE_LABELS: Record<ExportProgress["stage"], string> = {
  video: "Rendering video",
  audio: "Copying audio",
  finalizing: "Finalising file",
};

interface Result {
  url: string;
  name: string;
  size: number;
}

/**
 * The whole export, start to finish, in one card: settings → progress →
 * the finished file.
 *
 * Modal from the moment rendering starts. An export mutates nothing, but it
 * reads the document for several minutes while the editor would happily keep
 * changing it — and a keyframe moved mid-render lands in some frames and not
 * others. Blocking is simpler to reason about than snapshotting, and it also
 * stops the export being forgotten in a sidebar while the user edits on.
 *
 * While rendering there is deliberately no way out but Cancel: no Escape, no
 * click-outside. Those read as "hide this", and a hidden-but-running export
 * that silently finishes is worse than a modal. The footer carries the one
 * exit at every step.
 */
export function ReframeExportDialog({
  doc,
  file,
  quality,
  includeAudio,
  unsupportedReason,
  open,
  onOpenChange,
  onSetTarget,
  onSetQuality,
  onSetIncludeAudio,
}: Props) {
  const [started, setStarted] = React.useState(false);
  const [progress, setProgress] = React.useState<ExportProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [colourPath, setColourPath] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Result | null>(null);
  // Closing the dialog is the only thing that throws the finished file away —
  // it lives in memory, not on disk — so an undownloaded result warns once.
  const [downloaded, setDownloaded] = React.useState(false);
  const [warnedUnsaved, setWarnedUnsaved] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  // The finished file's object URL outlives the dialog being closed, so a
  // download the browser is still writing can't be pulled out from under it.
  // It is released when this instance unmounts, which is when the next run
  // starts (new key) or the editor goes away.
  const urlRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  // One run per instance — the editor keys this component by run number, so
  // every Export press gets a clean dialog and `started` only ever goes
  // false → true once. Everything below is async, so nothing is set
  // synchronously during the effect.
  React.useEffect(() => {
    if (!started) return;
    const controller = new AbortController();
    abortRef.current = controller;
    let alive = true;

    (async () => {
      try {
        const blob = await exportReframedVideo({
          doc,
          file,
          quality,
          includeAudio,
          signal: controller.signal,
          onProgress: (p) => alive && setProgress(p),
          onNotice: (n) => alive && setNotice(n),
          onColourPath: (c) => alive && setColourPath(c),
        });
        if (!alive) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        setResult({ url: urlRef.current, name: suggestedFilename(doc), size: blob.size });
      } catch (e) {
        if (!alive) return;
        // Cancelling is a decision, not a failure: close and say nothing.
        if (e instanceof ExportCanceledError) onOpenChange(false);
        else setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setProgress(null);
        abortRef.current = null;
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
    // Settings are read once, when Start is pressed; the run must not restart
    // because something re-rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // Not `progress !== null`: progress stays null through the first frame's
  // decode and colour probe, and the dialog must already be un-dismissable
  // there — otherwise Escape hides a render that keeps going.
  const running = started && !result && !error;
  const isReel = doc.segments.length > 1;
  const kept = doc.segments.length > 0 ? totalSegmentDuration(doc) : doc.source.duration;
  const percent = progress ? Math.round(progress.fraction * 100) : 0;
  const preset = findTargetPreset(doc.target);
  // Resolutions for the shape chosen in the editor. A hand-edited custom size
  // falls back to the vertical tiers, and shows itself as the current option.
  const sizes = TARGET_PRESETS[preset?.aspect ?? "9:16"];
  /*
   * How many source pixels this shape actually has to work with. A 9:16
   * window out of a 16:9 frame is only 31.6% of its width, so 4K footage
   * yields a 1215-wide crop — anything above that is interpolation: a bigger
   * file (bitrate scales with pixel count) carrying the same detail.
   *
   * Measured at zoom 1, the best case. Punching in only makes it smaller, so
   * a size flagged here is wasteful at every zoom.
   */
  const native = maxCropExtent(doc);
  const upscales = (s: TargetSize) => s.width > native.width + 0.5;
  // Shown in place rather than by grimly disabling the header button: this is
  // where someone looks when they want to export. No keyframe is required —
  // with none the crop sits centred, which at 16:9 is the whole frame, so
  // this doubles as a trimmer.
  const blockedReason = unsupportedReason;

  /**
   * Close, but warn once first if the finished file was never downloaded.
   * A second attempt goes through: the reminder is a nudge, not a gate.
   */
  const requestClose = () => {
    if (result && !downloaded && !warnedUnsaved) {
      setWarnedUnsaved(true);
      return;
    }
    onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        if (running) return;
        requestClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-card border border-divider bg-surface-high p-5 shadow-2xl focus:outline-none"
          onEscapeKeyDown={(e) => running && e.preventDefault()}
          onPointerDownOutside={(e) => running && e.preventDefault()}
          onInteractOutside={(e) => running && e.preventDefault()}
        >
          <DialogPrimitive.Title className="text-lg font-semibold text-text-primary">
            {result ? "Export complete" : error ? "Export failed" : started ? "Exporting" : "Export"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-sm text-text-secondary">
            {result
              ? result.name
              : error
                ? "Nothing was saved."
                : `${isReel ? `${doc.segments.length} segments · ` : ""}${formatTimecode(kept)} · ${doc.target.width}×${doc.target.height}`}
          </DialogPrimitive.Description>

          {/* ── Settings ─────────────────────────────────────────────── */}
          {!started && (
            <div className="mt-5 space-y-3">
              {/* Shape is chosen in the editor, where you can see what you are
                  framing — only the file settings live here. */}
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-xs text-text-secondary">Resolution</span>
                  <Select
                    aria-label="Output resolution"
                    value={preset ? String(preset.index) : ""}
                    onChange={(e) => onSetTarget(sizes[Number(e.target.value)])}
                    className="py-2 text-sm"
                  >
                    {!preset && (
                      <option value="">
                        {doc.target.width}×{doc.target.height}
                      </option>
                    )}
                    {sizes.map((s: TargetSize, i: number) => (
                      <option key={`${s.width}x${s.height}`} value={i}>
                        {s.width}×{s.height}
                        {upscales(s) ? " · upscaled" : ""}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-text-secondary">Quality</span>
                  <Select
                    aria-label="Quality"
                    value={quality}
                    onChange={(e) => onSetQuality(e.target.value as ExportQuality)}
                    className="py-2 text-sm"
                  >
                    {(Object.keys(QUALITY_LABELS) as ExportQuality[]).map((q) => (
                      <option key={q} value={q}>
                        {QUALITY_LABELS[q]}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>

              <p className="text-xs text-text-secondary">
                This shape takes {Math.round(native.width)}×{Math.round(native.height)} from
                the source.
                {preset && upscales(sizes[preset.index])
                  ? " Larger sizes are upscaled: bigger file, no more detail — worth it only if the platform you post to expects them."
                  : ""}
              </p>

              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={includeAudio}
                  onChange={(e) => onSetIncludeAudio(e.target.checked)}
                  className="accent-accent"
                />
                Keep original audio
              </label>

              {blockedReason && <p className="text-xs text-warning">{blockedReason}</p>}
            </div>
          )}

          {/* ── Progress ─────────────────────────────────────────────── */}
          {running && (
            <div className="mt-5 space-y-3">
              <div className="h-2 w-full overflow-hidden rounded-pill bg-surface">
                <div
                  className="h-full rounded-pill bg-accent transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span className="flex items-center gap-2">
                  <Spinner className="h-3.5 w-3.5 text-accent" />
                  {progress
                    ? `${
                        progress.stage === "audio" && isReel
                          ? "Stitching audio"
                          : STAGE_LABELS[progress.stage]
                      }${
                        progress.segmentCount > 1 && progress.stage === "video"
                          ? ` · segment ${progress.segmentIndex}/${progress.segmentCount}`
                          : ""
                      } · ${progress.framesRendered} frames`
                    : "Starting…"}
                </span>
                <span className="font-mono">{percent}%</span>
              </div>
            </div>
          )}

          {/* ── Result ───────────────────────────────────────────────── */}
          {result && (
            <div className="mt-4 space-y-3">
              {/* No autoplay: autoplay would have to be muted, and hearing the
                  audio is half the point of checking the export. */}
              <video
                src={result.url}
                controls
                playsInline
                className="mx-auto max-h-[50vh] rounded-small bg-black"
              />
              <a
                href={result.url}
                download={result.name}
                onClick={() => setDownloaded(true)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-button bg-accent px-4 py-2.5 text-[15px] font-semibold text-background hover:opacity-90"
              >
                <Download className="h-4 w-4" />
                Download · {formatBytes(result.size)}
              </a>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

          {(colourPath || notice) && (
            <div className="mt-3 space-y-1">
              {colourPath && <p className="text-xs text-text-secondary">{colourPath}</p>}
              {notice && <p className="text-xs text-warning">{notice}</p>}
            </div>
          )}

          {/* The reminder is text, not a second set of buttons: one Download
              is enough, and pressing Close again simply goes through. */}
          {warnedUnsaved && !downloaded && (
            <p className="mt-3 text-center text-xs text-warning">
              You haven&rsquo;t downloaded this yet — press Close again to discard it.
            </p>
          )}

          <div className="mt-4 flex gap-2">
            {!started ? (
              <>
                <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  className="flex-[2]"
                  disabled={Boolean(blockedReason)}
                  onClick={() => setStarted(true)}
                >
                  Start export
                </Button>
              </>
            ) : running ? (
              <Button variant="secondary" fullWidth onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            ) : (
              <Button variant="secondary" fullWidth onClick={requestClose}>
                Close
              </Button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
