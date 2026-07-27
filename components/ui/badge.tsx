import * as React from "react";
import { cn } from "@/lib/utils";
import type { MatchStatus } from "@/lib/types";

type Tone = "neutral" | "accent" | "success" | "warning" | "destructive";

const tones: Record<Tone, string> = {
  neutral: "bg-surface text-text-secondary border border-divider",
  accent: "bg-accent-muted text-accent",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

const statusTone: Record<MatchStatus, Tone> = {
  scheduled: "neutral",
  in_progress: "warning",
  completed: "success",
  forfeit: "destructive",
  cancelled: "destructive",
};

const statusLabel: Record<MatchStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  forfeit: "Forfeit",
  cancelled: "Cancelled",
};

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  return <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>;
}
