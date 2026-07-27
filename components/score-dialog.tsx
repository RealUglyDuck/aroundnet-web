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
  open,
  onOpenChange,
  onSubmitted,
}: {
  match: MatchVM;
  bestOf: number;
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
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">{match.teamAName ?? "Team A"}</span>
            <span />
            <span className="font-medium">{match.teamBName ?? "Team B"}</span>
            <span />
          </div>

          <div className="space-y-2">
            {scores.map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-12 text-xs text-text-secondary">Set {i + 1}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={s.a ?? ""}
                  onChange={(e) => update(i, "a", e.target.value)}
                  className="w-16 rounded-small border border-divider bg-surface px-2 py-1.5 text-center tabular-nums focus:border-accent/60 focus:outline-none"
                />
                <span className="text-text-secondary">–</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={s.b ?? ""}
                  onChange={(e) => update(i, "b", e.target.value)}
                  className="w-16 rounded-small border border-divider bg-surface px-2 py-1.5 text-center tabular-nums focus:border-accent/60 focus:outline-none"
                />
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Spinner /> : "Save score"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
