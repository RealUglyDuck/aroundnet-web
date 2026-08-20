"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { totalSegmentDuration, type ReframeDoc } from "@/lib/reframe/model";
import { formatTimecode } from "@/lib/reframe/format";

interface Props {
  doc: ReframeDoc;
  selectedSegmentId: string | null;
  segmentsOnly: boolean;
  /** In-point of the segment being marked, if any. */
  openIn: number | null;
  onToggleSegmentsOnly: () => void;
  onSelect: (id: string | null) => void;
  onSeek: (t: number) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

function ReframeSegmentsPanelInner({
  doc,
  selectedSegmentId,
  segmentsOnly,
  openIn,
  onToggleSegmentsOnly,
  onSelect,
  onSeek,
  onRename,
  onDelete,
  onClearAll,
}: Props) {
  const fps = doc.source.frameRate;
  const total = totalSegmentDuration(doc);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Segments
        </span>
        {doc.segments.length > 0 && (
          <span className="text-xs text-text-secondary">
            {doc.segments.length} · {formatTimecode(total)}
          </span>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={segmentsOnly}
          onChange={onToggleSegmentsOnly}
          className="accent-accent"
        />
        Play segments only <kbd className="rounded bg-surface px-1 text-xs">T</kbd>
      </label>

      {segmentsOnly && doc.segments.length > 0 && (
        <p className="rounded-small bg-surface p-3 text-xs text-text-secondary">
          The timeline is showing the <span className="text-text-primary">reel</span> —
          gaps are collapsed, so its timecodes are the exported ones. Turn this off to mark
          new segments or drag their edges.
        </p>
      )}

      {openIn !== null && (
        <p className="rounded-small bg-accent-muted px-3 py-2 text-xs text-text-primary">
          In point set at{" "}
          <span className="font-mono text-accent">{formatTimecode(openIn, fps)}</span> — press{" "}
          <kbd className="rounded bg-surface px-1">F</kbd> to close the segment,{" "}
          <kbd className="rounded bg-surface px-1">A</kbd> to nudge it, or{" "}
          <kbd className="rounded bg-surface px-1">Esc</kbd> to drop it. Once you are well
          past it, <kbd className="rounded bg-surface px-1">A</kbd> closes the segment too —{" "}
          <kbd className="rounded bg-surface px-1">⇧A</kbd> forces the in-point to move.
        </p>
      )}

      {doc.segments.length === 0 ? (
        <p className="rounded-small bg-surface p-3 text-sm text-text-secondary">
          Press <kbd className="rounded bg-surface-high px-1">A</kbd> to mark an in-point and{" "}
          <kbd className="rounded bg-surface-high px-1">F</kbd> to close it. Segments export
          joined end to end as one reel; with none marked, the whole clip is exported.
        </p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {doc.segments.map((seg) => {
            const isSelected = seg.id === selectedSegmentId;
            return (
              <li key={seg.id}>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-small px-2 py-1.5 transition-colors",
                    isSelected ? "bg-accent-muted" : "bg-surface hover:bg-surface-high",
                  )}
                >
                  <button
                    type="button"
                    className="shrink-0 text-left"
                    onClick={() => {
                      onSelect(seg.id);
                      onSeek(seg.start);
                    }}
                    title="Jump to this segment"
                  >
                    <span className="font-mono text-xs text-text-primary">
                      {formatTimecode(seg.start, fps)}
                    </span>
                    <span className="mx-1 text-text-secondary">→</span>
                    <span className="font-mono text-xs text-text-primary">
                      {formatTimecode(seg.end, fps)}
                    </span>
                  </button>

                  <input
                    value={seg.name}
                    onChange={(e) => onRename(seg.id, e.target.value)}
                    onFocus={() => onSelect(seg.id)}
                    aria-label="Segment name"
                    className="min-w-0 flex-1 rounded-small border border-transparent bg-transparent px-1 py-0.5 text-sm text-text-secondary hover:border-divider focus:border-accent/60 focus:text-text-primary focus:outline-none"
                  />

                  <span className="shrink-0 text-xs tabular-nums text-text-secondary">
                    {formatTimecode(seg.end - seg.start)}
                  </span>

                  <button
                    type="button"
                    aria-label={`Delete ${seg.name}`}
                    className="shrink-0 rounded-small p-1 text-text-secondary hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => onDelete(seg.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {doc.segments.length > 0 && (
        <Button variant="secondary" size="sm" fullWidth onClick={onClearAll}>
          Clear all segments
        </Button>
      )}
    </div>
  );
}

// The editor re-renders on every playhead tick while scrubbing or playing.
// Nothing here depends on the playhead, so memoising keeps that work off the
// drag path entirely.
export const ReframeSegmentsPanel = React.memo(ReframeSegmentsPanelInner);
