"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createDivisions } from "@/lib/supabase/mutations";
import type { TournamentVM } from "@/lib/types";

export function AddDivisionDialog({
  tournament,
  open,
  onOpenChange,
  onDone,
}: {
  tournament: TournamentVM;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = React.useState("");
  const [min, setMin] = React.useState(2);
  const [max, setMax] = React.useState(2);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Mirrors the valid_div_team_size check on the table, so a bad range reads as
  // a sentence rather than a Postgres constraint violation.
  const validation =
    min < 1 || max < min ? "Max players must be at least the minimum, and at least 1." : null;

  async function submit() {
    if (validation || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createDivisions(tournament.id, [
        {
          name: name.trim(),
          min_team_size: min,
          max_team_size: max,
          sort_order: tournament.divisions.length,
        },
      ]);
      setName("");
      setMin(2);
      setMax(2);
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add division");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add division">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving) submit();
          }}
        >
          <p className="text-sm text-text-secondary">
            Divisions group teams (e.g. Open, Women&apos;s, Mixed) and set how many players
            a team may register.
          </p>

          <Field label="Division name">
            <Input
              autoFocus
              value={name}
              placeholder="e.g. Women's"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Min players" hint="Fewest per team">
              <Input
                type="number"
                min={1}
                value={min}
                onChange={(e) => setMin(Number(e.target.value))}
              />
            </Field>
            <Field label="Max players" hint="Most per team — raise it to allow substitutes">
              <Input
                type="number"
                min={1}
                value={max}
                onChange={(e) => setMax(Number(e.target.value))}
              />
            </Field>
          </div>

          {(error || validation) && (
            <p className="text-sm text-destructive">{error ?? validation}</p>
          )}

          <div className="flex justify-end gap-2">
            {/* type="button": inside a form an untyped button defaults to submit. */}
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !name.trim() || !!validation}>
              {saving ? <Spinner /> : "Add division"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
