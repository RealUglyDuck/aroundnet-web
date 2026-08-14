"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { generateBracket } from "@/lib/supabase/functions";
import type { DivisionVM, TournamentVM } from "@/lib/types";
import { SCORING_DEFAULTS } from "@/lib/types";

export function BracketSetupDialog({
  tournament,
  division,
  open,
  onOpenChange,
  onDone,
}: {
  tournament: TournamentVM;
  division: DivisionVM;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const groupStages = division.stages.filter((s) => s.type === "group_stage");
  const [sources, setSources] = React.useState<Set<string>>(
    () => new Set(groupStages.map((s) => s.id)),
  );
  const [bracketCount, setBracketCount] = React.useState<1 | 2>(1);
  const [topSize, setTopSize] = React.useState(4);
  const [ptw, setPtw] = React.useState(SCORING_DEFAULTS.pointsToWin);
  const [cap, setCap] = React.useState(SCORING_DEFAULTS.hardCap);
  const [bestOf, setBestOf] = React.useState(SCORING_DEFAULTS.bestOf);
  const [stageName, setStageName] = React.useState("Bracket Stage");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Number("") is 0 and the HTML min/max are only hints to a controlled input,
  // so the bounds are enforced here rather than trusted.
  const validation =
    sources.size === 0
      ? "Select at least one source group stage."
      : bracketCount === 2 && (!Number.isInteger(topSize) || topSize < 2)
        ? "Top bracket size must be at least 2."
        : !Number.isInteger(ptw) || ptw < 1
          ? "Points to win must be at least 1."
          : !Number.isInteger(cap) || cap < ptw
            ? "Hard cap must be at least the points needed to win."
            : null;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await generateBracket({
        tournament_id: tournament.id,
        division_id: division.id,
        source_stage_ids: [...sources],
        stage_name: stageName.trim() || "Bracket Stage",
        bracket_count: bracketCount,
        top_bracket_size: bracketCount === 2 ? topSize : undefined,
        best_of: bestOf,
        points_to_win: ptw,
        hard_cap: cap,
      });
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate bracket");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add bracket stage" className="max-w-lg">
        {groupStages.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Create and complete a group stage first — brackets are seeded from group standings.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-sm font-medium">Seed from group stage(s)</p>
              <div className="space-y-1 rounded-small border border-divider p-2">
                {groupStages.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={sources.has(s.id)}
                      onChange={(e) => {
                        setSources((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(s.id);
                          else next.delete(s.id);
                          return next;
                        });
                      }}
                      className="accent-[var(--color-accent)]"
                    />
                    {s.name} ({s.groups.length} groups)
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Brackets">
                <Select
                  value={bracketCount}
                  onChange={(e) => setBracketCount(Number(e.target.value) as 1 | 2)}
                >
                  <option value={1}>1 — Championship</option>
                  <option value={2}>2 — Championship + flight</option>
                </Select>
              </Field>
              {bracketCount === 2 && (
                <Field label="Top bracket size" hint="Teams in the championship bracket">
                  <Input
                    type="number"
                    min={2}
                    max={16}
                    value={topSize}
                    onChange={(e) => setTopSize(Number(e.target.value))}
                  />
                </Field>
              )}
            </div>

            {/* Same gap as the group dialog had: iOS AddBracketStageView names
                the stage, the web hardcoded it. */}
            <Field label="Stage name">
              <Input
                value={stageName}
                placeholder="Bracket Stage"
                onChange={(e) => setStageName(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Points">
                <Input type="number" value={ptw} onChange={(e) => setPtw(Number(e.target.value))} />
              </Field>
              <Field label="Hard cap">
                <Input type="number" value={cap} onChange={(e) => setCap(Number(e.target.value))} />
              </Field>
              {/* Odd only — see the note in group-setup-dialog. A knockout
                  match especially cannot end level: something has to advance. */}
              <Field label="Best of">
                <Select value={bestOf} onChange={(e) => setBestOf(Number(e.target.value))}>
                  <option value={1}>1 game</option>
                  <option value={3}>Best of 3</option>
                  <option value={5}>Best of 5</option>
                </Select>
              </Field>
            </div>

            {(error || validation) && (
              <p className="text-sm text-destructive">{error ?? validation}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={saving || !!validation}>
                {saving ? <Spinner /> : "Generate bracket"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
