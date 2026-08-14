"use client";

import * as React from "react";
import type { BracketVM, BracketMatchVM, MatchVM } from "@/lib/types";
import type { SlotSeeds } from "@/lib/bracket-seeds";
import { ordinal } from "@/lib/format";
import { MatchCard } from "./match-card";

/**
 * What a final-round match decides. The bracket lines already encode it: the
 * better of the two numbers is the place on offer, so (1,2) is the 1st-place
 * match and (4,3) the 3rd-place one.
 */
function placeLabel(seeds: SlotSeeds | undefined): string | null {
  if (!seeds) return null;
  const known = [seeds.a, seeds.b].filter((n): n is number => n != null);
  if (known.length === 0) return null;
  return `${ordinal(Math.min(...known))} Place`;
}

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
  seeds,
  canEditMatch,
  onSubmitted,
}: {
  bracket: BracketVM;
  bestOf: number;
  /** Slot seed numbers for the whole stage, keyed by match id. */
  seeds?: Map<string, SlotSeeds>;
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
                {matches.map((m) => {
                  const place = r === maxRound ? placeLabel(seeds?.get(m.id)) : null;
                  return (
                    <div key={m.id} className="space-y-1">
                      {place && (
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                          {place}
                        </div>
                      )}
                      <MatchCard
                        match={m}
                        bestOf={bestOf}
                        seeds={seeds?.get(m.id)}
                        canEdit={canEditMatch?.(m) ?? false}
                        onSubmitted={onSubmitted}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
