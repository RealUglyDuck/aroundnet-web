"use client";

import * as React from "react";
import { Check, Pencil } from "lucide-react";
import type { MatchVM } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ScoreDialog } from "./score-dialog";

/** One set's score for one team, and whether that team took the set. */
interface ScoreCell {
  value: number | null;
  wonSet: boolean;
}

function TeamRow({
  name,
  scores,
  seed,
  isWinner,
  isLoser,
  empty,
}: {
  name: string | null;
  scores: ScoreCell[];
  /** Bracket line number this slot carries, if any. */
  seed?: number | null;
  isWinner: boolean;
  /** Decided against, once the match has a winner — dimmed. */
  isLoser: boolean;
  empty: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1.5">
        {seed != null && (
          <span
            className="w-4 shrink-0 text-right text-[11px] tabular-nums text-text-secondary"
            title={`Seed ${seed}`}
          >
            {seed}
          </span>
        )}
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
      {/* Highlighted per set, not per match: in 15-7 7-15 17-5 the middle set
          belongs to the other team even though this one won overall. */}
      <div className="flex shrink-0 items-center gap-1.5 tabular-nums">
        {scores.map((s, i) => (
          <span
            key={i}
            className={cn(
              "w-5 text-center text-sm",
              s.wonSet ? "font-semibold text-accent" : "text-text-secondary",
            )}
          >
            {s.value ?? "·"}
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
  seeds,
  onSubmitted,
  className,
}: {
  match: MatchVM;
  bestOf: number;
  canEdit?: boolean;
  /** Bracket line numbers for the two slots — omitted in group stages. */
  seeds?: { a: number | null; b: number | null };
  onSubmitted: () => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  // A set is only won by someone once both scores are in and they differ, so a
  // half-entered or level set highlights neither side.
  const aScores: ScoreCell[] = match.sets.map((s) => ({
    value: s.score_a,
    wonSet: s.score_a != null && s.score_b != null && s.score_a > s.score_b,
  }));
  const bScores: ScoreCell[] = match.sets.map((s) => ({
    value: s.score_b,
    wonSet: s.score_a != null && s.score_b != null && s.score_b > s.score_a,
  }));
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

  // Bracket lines read best low-to-high: a 4 vs 3 match shows 3 on top. The
  // dialog is told to match, so the sides can't drift apart.
  const swapped =
    seeds?.a != null && seeds.b != null ? seeds.b < seeds.a : false;

  const rowA = {
    side: "a",
    name: match.teamAName,
    scores: aScores,
    seed: seeds?.a,
    isWinner: winA,
    isLoser: isDecided && winB,
    empty: match.team_a_id == null,
    // On a bye the empty side is left out entirely — the note below says it.
    present: !match.is_bye || match.team_a_id != null,
  };
  const rowB = {
    side: "b",
    name: match.teamBName,
    scores: bScores,
    seed: seeds?.b,
    isWinner: winB,
    isLoser: isDecided && winA,
    empty: match.team_b_id == null,
    present: !match.is_bye || match.team_b_id != null,
  };
  const rows = (swapped ? [rowB, rowA] : [rowA, rowB]).filter((r) => r.present);

  const body = (
    <>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <TeamRow
            key={row.side}
            name={row.name}
            scores={row.scores}
            seed={row.seed}
            isWinner={row.isWinner}
            isLoser={row.isLoser}
            empty={row.empty}
          />
        ))}
      </div>
      {/* Just "Bye": in a group stage there is nowhere to advance to, the team
          simply sits the round out. */}
      {match.is_bye && <p className="mt-2 text-xs text-text-secondary">Bye</p>}
    </>
  );

  if (!editable) {
    return <div className={shell}>{body}</div>;
  }

  const action = isDecided ? "Edit score" : "Enter score";
  const teams = rows.map((r) => r.name ?? "TBD").join(" vs ");

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
          swapped={swapped}
          open={open}
          onOpenChange={setOpen}
          onSubmitted={onSubmitted}
        />
      )}
    </>
  );
}
