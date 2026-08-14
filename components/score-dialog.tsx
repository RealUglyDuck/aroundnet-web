"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { submitScore } from "@/lib/supabase/functions";
import type { MatchVM } from "@/lib/types";

export function ScoreDialog({
  match,
  bestOf,
  swapped,
  open,
  onOpenChange,
  onSubmitted,
}: {
  match: MatchVM;
  bestOf: number;
  /** Card shows the teams the other way round — mirror it so scores can't be
   *  typed into the wrong side. Submission still keys off the match's own A/B. */
  swapped?: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmitted: () => void;
}) {
  const setCount = Math.max(bestOf, match.sets.length || bestOf);
  const initial = React.useMemo(
    () =>
      Array.from({ length: setCount }, (_, i) => {
        const s = match.sets.find((x) => x.set_number === i + 1);
        return {
          a: s?.score_a ?? null,
          b: s?.score_b ?? null,
        };
      }),
    [match, setCount],
  );

  const [scores, setScores] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => setScores(initial), [initial]);

  const [leftSide, rightSide] = swapped ? (["b", "a"] as const) : (["a", "b"] as const);
  const leftName = (swapped ? match.teamBName : match.teamAName) ?? "Team A";
  const rightName = (swapped ? match.teamAName : match.teamBName) ?? "Team B";

  function update(i: number, side: "a" | "b", raw: string) {
    const v = raw === "" ? null : Number(raw);
    setScores((prev) => prev.map((s, idx) => (idx === i ? { ...s, [side]: v } : s)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Submit each fully-entered set in order; the edge function recomputes
      // the match result and propagates the winner after each call.
      for (let i = 0; i < scores.length; i++) {
        const s = scores[i];
        if (s.a === null || s.b === null) continue;
        await submitScore({
          match_id: match.id,
          set_number: i + 1,
          score_a: s.a,
          score_b: s.b,
        });
      }
      onSubmitted();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit score");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Enter score">
        {/* A real form, so Enter from any score box submits — the native
            behaviour, which also keeps the button working for pointer users. */}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving) save();
          }}
        >
          {/* Teams side by side, matching the left/right score columns below
              (and iOS EnterScoreView's header card). */}
          <div className="flex items-baseline justify-center gap-2 rounded-small bg-surface px-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-right font-semibold">{leftName}</span>
            <span className="shrink-0 text-xs text-text-secondary">vs</span>
            <span className="min-w-0 flex-1 truncate text-left font-semibold">{rightName}</span>
          </div>

          <div className="space-y-2">
            {scores.map((s, i) => {
              const left = s[leftSide];
              const right = s[rightSide];
              const setWinner =
                left === null || right === null || left === right
                  ? null
                  : left > right
                    ? leftName
                    : rightName;
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-12 shrink-0 text-xs text-text-secondary">Set {i + 1}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={left ?? ""}
                    onChange={(e) => update(i, leftSide, e.target.value)}
                    aria-label={`${leftName} score, set ${i + 1}`}
                    className="w-16 rounded-small border border-divider bg-surface px-2 py-1.5 text-center tabular-nums focus:border-accent/60 focus:outline-none"
                  />
                  <span className="text-text-secondary">–</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={right ?? ""}
                    onChange={(e) => update(i, rightSide, e.target.value)}
                    aria-label={`${rightName} score, set ${i + 1}`}
                    className="w-16 rounded-small border border-divider bg-surface px-2 py-1.5 text-center tabular-nums focus:border-accent/60 focus:outline-none"
                  />
                  {/* Names the set winner, so it stays obvious which column is
                      whose once you scroll past the header. */}
                  {setWinner && (
                    <span className="min-w-0 truncate text-xs text-accent">{setWinner}</span>
                  )}
                </div>
              );
            })}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            {/* Explicitly type="button": inside a form an untyped button
                defaults to submit, which would make Cancel save the score. */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <Spinner /> : "Save score"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
