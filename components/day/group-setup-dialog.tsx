"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { generateGroupMatches, type GroupInput } from "@/lib/supabase/functions";
import type { DivisionVM, TournamentVM } from "@/lib/types";
import { SCORING_DEFAULTS } from "@/lib/types";

const groupLetter = (i: number) => String.fromCharCode(65 + i);

export function GroupSetupDialog({
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
  const teams = division.teams;
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(teams.map((t) => t.id)),
  );
  const [numGroups, setNumGroups] = React.useState(teams.length >= 8 ? 2 : 1);
  const [mode, setMode] = React.useState<"even" | "manual">("even");
  const [manual, setManual] = React.useState<Record<string, number>>({});
  const [ptw, setPtw] = React.useState(SCORING_DEFAULTS.pointsToWin);
  const [cap, setCap] = React.useState(SCORING_DEFAULTS.hardCap);
  const [bestOf, setBestOf] = React.useState(1);
  const [gpm, setGpm] = React.useState(1);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const chosen = teams.filter((t) => selected.has(t.id));

  const groups: GroupInput[] = React.useMemo(() => {
    const buckets: string[][] = Array.from({ length: numGroups }, () => []);
    chosen.forEach((t, i) => {
      const gi = mode === "manual" ? manual[t.id] ?? 0 : i % numGroups;
      const idx = Math.min(gi, numGroups - 1);
      buckets[idx].push(t.id);
    });
    return buckets.map((ids, i) => ({ name: `Group ${groupLetter(i)}`, tournament_team_ids: ids }));
  }, [chosen, numGroups, mode, manual]);

  const validation = React.useMemo(() => {
    const nonEmpty = groups.filter((g) => g.tournament_team_ids.length > 0);
    if (chosen.length < 2) return "Select at least 2 teams.";
    const tooSmall = nonEmpty.find((g) => g.tournament_team_ids.length < 2);
    if (tooSmall) return `${tooSmall.name} needs at least 2 teams.`;
    return null;
  }, [groups, chosen]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await generateGroupMatches({
        tournament_id: tournament.id,
        division_id: division.id,
        stage_name: "Group Stage",
        points_to_win: ptw,
        hard_cap: cap,
        best_of: bestOf,
        games_per_matchup: gpm,
        groups: groups.filter((g) => g.tournament_team_ids.length > 0),
      });
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create group stage");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add group stage" className="max-w-xl">
        {teams.length < 2 ? (
          <p className="text-sm text-text-secondary">
            You need at least 2 registered teams in {division.name} first.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Team selection */}
            <div>
              <p className="mb-1.5 text-sm font-medium">Teams ({chosen.length})</p>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-small border border-divider p-2">
                {teams.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={(e) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(t.id);
                          else next.delete(t.id);
                          return next;
                        });
                      }}
                      className="accent-[var(--color-accent)]"
                    />
                    {t.teamName ?? "Team"}
                    {mode === "manual" && selected.has(t.id) && (
                      <Select
                        className="ml-auto w-28 py-1"
                        value={manual[t.id] ?? 0}
                        onChange={(e) =>
                          setManual((m) => ({ ...m, [t.id]: Number(e.target.value) }))
                        }
                      >
                        {Array.from({ length: numGroups }, (_, i) => (
                          <option key={i} value={i}>
                            Group {groupLetter(i)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Number of groups">
                <Input
                  type="number"
                  min={1}
                  max={Math.max(1, Math.floor(chosen.length / 2))}
                  value={numGroups}
                  onChange={(e) => setNumGroups(Math.max(1, Number(e.target.value)))}
                />
              </Field>
              <Field label="Distribution">
                <Select value={mode} onChange={(e) => setMode(e.target.value as "even" | "manual")}>
                  <option value="even">Even (rotating by seed)</option>
                  <option value="manual">Manual</option>
                </Select>
              </Field>
            </div>

            {/* Preview */}
            <div className="rounded-small bg-surface p-3 text-xs text-text-secondary">
              {groups
                .filter((g) => g.tournament_team_ids.length > 0)
                .map((g) => `${g.name}: ${g.tournament_team_ids.length}`)
                .join("  ·  ")}
            </div>

            <div className="grid grid-cols-4 gap-3">
              <Field label="Points">
                <Input type="number" value={ptw} onChange={(e) => setPtw(Number(e.target.value))} />
              </Field>
              <Field label="Hard cap">
                <Input type="number" value={cap} onChange={(e) => setCap(Number(e.target.value))} />
              </Field>
              <Field label="Best of">
                <Input type="number" min={1} value={bestOf} onChange={(e) => setBestOf(Number(e.target.value))} />
              </Field>
              <Field label="Games/pair">
                <Input type="number" min={1} value={gpm} onChange={(e) => setGpm(Number(e.target.value))} />
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
                {saving ? <Spinner /> : "Create group stage"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
