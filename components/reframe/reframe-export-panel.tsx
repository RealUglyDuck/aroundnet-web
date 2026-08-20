"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import {
  TARGET_PRESETS,
  type ReframeDoc,
  type TargetPresetKey,
} from "@/lib/reframe/model";
import {
  ExportCanceledError,
  checkExportSupport,
  exportReframedVideo,
  suggestedFilename,
  type ExportProgress,
  type ExportQuality,
} from "@/lib/reframe/export";
import { formatBytes } from "@/lib/reframe/format";

interface Props {
  doc: ReframeDoc;
  file: File;
  onSetTarget: (target: { width: number; height: number }) => void;
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

export function ReframeExportPanel({ doc, file, onSetTarget }: Props) {
  const [quality, setQuality] = React.useState<ExportQuality>("high");
  const [includeAudio, setIncludeAudio] = React.useState(true);
  const [progress, setProgress] = React.useState<ExportProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ url: string; name: string; size: number } | null>(
    null,
  );
  const [support, setSupport] = React.useState<{ ok: boolean; reason?: string } | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    let active = true;
    checkExportSupport().then((s) => active && setSupport(s));
    return () => {
      active = false;
    };
  }, []);

  // Object URLs for finished exports are held until replaced, so the download
  // link and the inline preview keep working.
  React.useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const presetKey = (Object.keys(TARGET_PRESETS) as TargetPresetKey[]).find(
    (k) =>
      TARGET_PRESETS[k].width === doc.target.width &&
      TARGET_PRESETS[k].height === doc.target.height,
  );

  const run = async () => {
    setError(null);
    setResult(null);
    setProgress({ fraction: 0, framesRendered: 0, stage: "video" });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const blob = await exportReframedVideo({
        doc,
        file,
        quality,
        includeAudio,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setResult({
        url: URL.createObjectURL(blob),
        name: suggestedFilename(doc),
        size: blob.size,
      });
    } catch (e) {
      if (!(e instanceof ExportCanceledError)) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  const busy = progress !== null;
  const disabled = busy || support?.ok === false || doc.keyframes.length === 0;

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Export
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Select
          aria-label="Output resolution"
          value={presetKey ?? ""}
          disabled={busy}
          onChange={(e) => onSetTarget(TARGET_PRESETS[e.target.value as TargetPresetKey])}
          className="py-2 text-sm"
        >
          {!presetKey && (
            <option value="">
              {doc.target.width}×{doc.target.height}
            </option>
          )}
          {(Object.keys(TARGET_PRESETS) as TargetPresetKey[]).map((k) => (
            <option key={k} value={k}>
              {TARGET_PRESETS[k].width}×{TARGET_PRESETS[k].height}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Quality"
          value={quality}
          disabled={busy}
          onChange={(e) => setQuality(e.target.value as ExportQuality)}
          className="py-2 text-sm"
        >
          {(Object.keys(QUALITY_LABELS) as ExportQuality[]).map((q) => (
            <option key={q} value={q}>
              {QUALITY_LABELS[q]}
            </option>
          ))}
        </Select>
      </div>

      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={includeAudio}
          disabled={busy}
          onChange={(e) => setIncludeAudio(e.target.checked)}
          className="accent-accent"
        />
        Keep original audio
      </label>

      {busy ? (
        <div className="space-y-2">
          <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface">
            <div
              className="h-full rounded-pill bg-accent transition-[width]"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>
              {STAGE_LABELS[progress.stage]} · {progress.framesRendered} frames
            </span>
            <button
              type="button"
              className="text-destructive hover:underline"
              onClick={() => abortRef.current?.abort()}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <Button fullWidth onClick={run} disabled={disabled}>
          Export {doc.target.width}×{doc.target.height} MP4
        </Button>
      )}

      {doc.keyframes.length === 0 && !busy && (
        <p className="text-xs text-text-secondary">Add at least one keyframe to export.</p>
      )}
      {support?.ok === false && (
        <p className="text-xs text-warning">{support.reason}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {result && (
        <div className="space-y-2 rounded-small bg-surface p-3">
          <video
            src={result.url}
            controls
            playsInline
            className="mx-auto max-h-64 rounded-small bg-black"
          />
          <a
            href={result.url}
            download={result.name}
            className="inline-flex w-full items-center justify-center gap-2 rounded-button bg-accent px-4 py-2.5 text-[15px] font-semibold text-background hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            Download · {formatBytes(result.size)}
          </a>
        </div>
      )}
    </div>
  );
}
