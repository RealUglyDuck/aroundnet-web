"use client";

import * as React from "react";
import { Select } from "@/components/ui/input";
import {
  TARGET_PRESETS,
  type ReframeDoc,
  type TargetPresetKey,
} from "@/lib/reframe/model";
import type { ExportQuality } from "@/lib/reframe/export";

interface Props {
  doc: ReframeDoc;
  quality: ExportQuality;
  includeAudio: boolean;
  /** Why export is unavailable in this browser, if it is. */
  unsupportedReason?: string;
  disabled: boolean;
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

/**
 * Export *settings* only. The button that acts on them lives in the header,
 * and the run itself takes over the screen — see reframe-export-dialog.tsx.
 */
function ReframeExportPanelInner({
  doc,
  quality,
  includeAudio,
  unsupportedReason,
  disabled,
  onSetTarget,
  onSetQuality,
  onSetIncludeAudio,
}: Props) {
  const presetKey = (Object.keys(TARGET_PRESETS) as TargetPresetKey[]).find(
    (k) =>
      TARGET_PRESETS[k].width === doc.target.width &&
      TARGET_PRESETS[k].height === doc.target.height,
  );

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Export settings
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Select
          aria-label="Output resolution"
          value={presetKey ?? ""}
          disabled={disabled}
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
          disabled={disabled}
          onChange={(e) => onSetQuality(e.target.value as ExportQuality)}
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
          disabled={disabled}
          onChange={(e) => onSetIncludeAudio(e.target.checked)}
          className="accent-accent"
        />
        Keep original audio
      </label>

      {doc.keyframes.length === 0 && (
        <p className="text-xs text-text-secondary">Add at least one keyframe to export.</p>
      )}
      {unsupportedReason && <p className="text-xs text-warning">{unsupportedReason}</p>}
    </div>
  );
}

// The editor re-renders on every playhead tick while scrubbing or playing.
// Nothing here depends on the playhead, so memoising keeps that work off the
// drag path entirely.
export const ReframeExportPanel = React.memo(ReframeExportPanelInner);
