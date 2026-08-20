"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EASINGS, type Easing, type ReframeDoc } from "@/lib/reframe/model";
import { solveState } from "@/lib/reframe/solve";
import { formatTimecode } from "@/lib/reframe/format";

interface Props {
  doc: ReframeDoc;
  currentTime: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeek: (t: number) => void;
  onRemove: (id: string) => void;
  onSetEasing: (id: string, easing: Easing) => void;
  /** Applies to the keyframe at the playhead, creating one if needed. */
  onSetZoom: (zoom: number) => void;
  onAddAtPlayhead: () => void;
}

const EASING_LABEL: Record<Easing, string> = {
  easeInOut: "Smooth",
  linear: "Linear",
  hold: "Hold",
};

export function ReframeInspector({
  doc,
  currentTime,
  selectedId,
  onSelect,
  onSeek,
  onRemove,
  onSetEasing,
  onSetZoom,
  onAddAtPlayhead,
}: Props) {
  const zoom = solveState(doc, currentTime).zoom;
  const selected = doc.keyframes.find((k) => k.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-sm font-medium">Zoom</span>
          <span className="font-mono text-xs text-text-secondary">{zoom.toFixed(2)}×</span>
        </div>
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => onSetZoom(Number(e.target.value))}
          className="w-full accent-accent"
        />
        <p className="mt-1 text-xs text-text-secondary">
          1× fills the full height of the source. Higher punches in.
        </p>
      </div>

      <Button variant="secondary" size="sm" fullWidth onClick={onAddAtPlayhead}>
        Add keyframe at playhead
      </Button>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Keyframes
        </div>
        {doc.keyframes.length === 0 ? (
          <p className="rounded-small bg-surface p-3 text-sm text-text-secondary">
            Tap the video to place your first keyframe. With one keyframe the crop stays
            put; with two or more it animates between them.
          </p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {doc.keyframes.map((kf, i) => {
              const isSelected = kf.id === selectedId;
              const isLast = i === doc.keyframes.length - 1;
              return (
                <li key={kf.id}>
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-small px-2 py-1.5 transition-colors",
                      isSelected ? "bg-accent-muted" : "bg-surface hover:bg-surface-high",
                    )}
                  >
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => {
                        onSelect(kf.id);
                        onSeek(kf.t);
                      }}
                    >
                      <span className="font-mono text-sm text-text-primary">
                        {formatTimecode(kf.t, doc.source.frameRate)}
                      </span>
                      <span className="ml-2 text-xs text-text-secondary">
                        x {Math.round(kf.cx * 100)}%
                        {kf.zoom > 1.001 && ` · ${kf.zoom.toFixed(2)}×`}
                      </span>
                    </button>

                    {/* The last keyframe governs nothing after it, so its
                        easing is meaningless — hide the control there. */}
                    {!isLast && (
                      <select
                        aria-label="Easing to the next keyframe"
                        value={kf.easing}
                        onChange={(e) => onSetEasing(kf.id, e.target.value as Easing)}
                        className="rounded-small border border-divider bg-background px-1.5 py-1 text-xs text-text-secondary focus:border-accent/60 focus:outline-none"
                      >
                        {EASINGS.map((e) => (
                          <option key={e} value={e}>
                            {EASING_LABEL[e]}
                          </option>
                        ))}
                      </select>
                    )}

                    <button
                      type="button"
                      aria-label="Delete keyframe"
                      className="rounded-small p-1 text-text-secondary hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onRemove(kf.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {selected && (
          <p className="mt-2 text-xs text-text-secondary">
            Drag markers on the timeline to retime. Press{" "}
            <kbd className="rounded bg-surface px-1">Delete</kbd> to remove the selected
            keyframe.
          </p>
        )}
      </div>
    </div>
  );
}
