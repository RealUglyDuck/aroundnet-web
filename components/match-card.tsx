"use client";

import * as React from "react";
import { Check, Pencil } from "lucide-react";
import type { MatchVM } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ScoreDialog } from "./score-dialog";

function TeamRow({
  name,
  scores,
  isWinner,
  isLoser,
  empty,
}: {
  name: string | null;
  scores: (number | null)[];
  isWinner: boolean;
  /** Decided against, once the match has a winner — dimmed. */
  isLoser: boolean;
  empty: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1.5">
        {isWinner && (
          <Check size={13} className="shrink-0 text-accent" aria-label="Winner" />
        )}
        <span
          className={cn(
            "truncate text-sm",
            isWinner && "font-semibold text-accent",
            isLoser && "text-text-secondary",
            !isWinner && !isLoser && "text-text-primary",
            empty && "text-text-secondary italic",
          )}
        >
          {name ?? (empty ? "TBD" : "—")}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-1.5 tabular-nums">
        {scores.map((s, i) => (
          <span
            key={i}
            className={cn(
              "w-5 text-center text-sm",
              isWinner ? "font-semibold text-accent" : "text-text-secondary",
            )}
          >
            {s ?? "·"}
          </span>
        ))}
      </div>
    </div>
  );
}

export function MatchCard({
  match,
  bestOf,
  canEdit,
  onSubmitted,
  className,
}: {
  match: MatchVM;
  bestOf: number;
  canEdit?: boolean;
  onSubmitted: () => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const aScores = match.sets.map((s) => s.score_a);
  const bScores = match.sets.map((s) => s.score_b);
  const winA = match.winner_id != null && match.winner_id === match.team_a_id;
  const winB = match.winner_id != null && match.winner_id === match.team_b_id;
  const hasBothTeams = match.team_a_id != null && match.team_b_id != null;
  // Played to a result — worth spotting at a glance in a wall of matches.
  const isDecided = match.status === "completed" && !match.is_bye;
  // The whole card is the scoring control when the viewer may score it.
  const editable = !!canEdit && hasBothTeams && !match.is_bye;

  const shell = cn(
    "block w-full rounded-small border px-3 py-2.5 text-left transition-colors",
    isDecided ? "border-success/45 bg-success/[0.04]" : "border-divider bg-surface",
    className,
  );

  const body = (
    <>
      <div className="space-y-1.5">
        <TeamRow
          name={match.teamAName}
          scores={aScores}
          isWinner={winA}
          isLoser={isDecided && winB}
          empty={match.team_a_id == null}
        />
        <TeamRow
          name={match.is_bye ? "Bye" : match.teamBName}
          scores={bScores}
          isWinner={winB}
          isLoser={isDecided && winA}
          empty={match.team_b_id == null && !match.is_bye}
        />
      </div>
      {match.is_bye && (
        <p className="mt-2 text-xs text-text-secondary">Bye — auto-advanced</p>
      )}
    </>
  );

  if (!editable) {
    return <div className={shell}>{body}</div>;
  }

  const action = isDecided ? "Edit score" : "Enter score";
  const teams = `${match.teamAName ?? "Team A"} vs ${match.teamBName ?? "Team B"}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={action}
        aria-label={`${action}: ${teams}`}
        className={cn(
          shell,
          // pr-7 reserves the gutter the pencil sits in, so it never overlaps
          // the right-aligned set scores on narrow bracket cards.
          "group relative cursor-pointer pr-7 hover:border-accent/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        )}
      >
        {body}
        <Pencil
          size={12}
          aria-hidden
          className="absolute right-2 top-1/2 -translate-y-1/2 text-accent opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </button>

      {open && (
        <ScoreDialog
          match={match}
          bestOf={bestOf}
          open={open}
          onOpenChange={setOpen}
          onSubmitted={onSubmitted}
        />
      )}
    </>
  );
}
