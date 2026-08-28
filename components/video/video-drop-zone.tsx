"use client";

import * as React from "react";
import { FolderOpen } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface Props {
  onPick: (file: File) => void;
  loading?: boolean;
  /** Prompt inside the zone. */
  label?: string;
  /** Second line, below the prompt. */
  hint?: string;
  /** Extra classes on the zone itself — mainly padding, for compact uses. */
  className?: string;
}

/**
 * Choose-or-drop target for a single local video file.
 *
 * A `<label>` around a visually hidden `<input type="file">` rather than a
 * button: it makes the whole area clickable and keyboard-reachable for free,
 * and the drop handlers can sit on the same element.
 */
export function VideoDropZone({
  onPick,
  loading = false,
  label = "Choose a video, or drop one here",
  hint = "Stays on your device — nothing is uploaded.",
  className,
}: Props) {
  const [dragOver, setDragOver] = React.useState(false);

  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed p-12 text-center transition",
        dragOver ? "border-accent bg-accent-muted" : "border-divider bg-surface",
        className,
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onPick(f);
      }}
    >
      <input
        type="file"
        accept="video/*"
        className="sr-only"
        disabled={loading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          // Cleared so picking the same file twice in a row still fires.
          e.target.value = "";
        }}
      />
      {loading ? (
        <>
          <Spinner className="h-6 w-6 text-accent" />
          <span className="text-sm text-text-secondary">Reading video…</span>
        </>
      ) : (
        <>
          <FolderOpen className="h-8 w-8 text-accent" />
          <span className="text-sm font-medium">{label}</span>
          {hint && <span className="text-xs text-text-secondary">{hint}</span>}
        </>
      )}
    </label>
  );
}
