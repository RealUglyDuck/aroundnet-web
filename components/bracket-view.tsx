"use client";

import * as React from "react";
import type { BracketVM, BracketMatchVM, MatchVM } from "@/lib/types";
import { MatchCard } from "./match-card";

function roundLabel(round: number, maxRound: number): string {
  const fromEnd = maxRound - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

export function BracketView({
  bracket,
  bestOf,
  canEditMatch,
  onSubmitted,
}: {
  bracket: BracketVM;
  bestOf: number;
  canEditMatch?: (match: MatchVM) => boolean;
  onSubmitted: () => void;
}) {
  const byRound = new Map<number, BracketMatchVM[]>();
  for (const m of bracket.matches) {
    const r = m.round ?? 1;
    const list = byRound.get(r);
    if (list) list.push(m);
    else byRound.set(r, [m]);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  const maxRound = rounds.length ? Math.max(...rounds) : 1;

  if (bracket.matches.length === 0) {
    return <p className="text-sm text-text-secondary">No matches in this bracket.</p>;
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-4">
        {rounds.map((r) => {
          const matches = (byRound.get(r) ?? []).sort(
            (a, b) => (a.position ?? 0) - (b.position ?? 0),
          );
          return (
            <div key={r} className="flex min-w-[220px] flex-col gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {roundLabel(r, maxRound)}
              </div>
              <div className="flex flex-1 flex-col justify-around gap-3">
                {matches.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    bestOf={bestOf}
                    canEdit={canEditMatch?.(m) ?? false}
                    onSubmitted={onSubmitted}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
