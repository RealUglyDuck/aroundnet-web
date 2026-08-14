"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { useTournament } from "@/lib/hooks/use-tournament";
import { updateTournament } from "@/lib/supabase/mutations";
import { toDatetimeLocal, fromDatetimeLocal } from "@/lib/format";
import type { TournamentVisibility } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Field } from "@/components/ui/input";
import { CenteredSpinner, Spinner } from "@/components/ui/spinner";

function EditTournament() {
  const params = useSearchParams();
  const id = params.get("id");
  const router = useRouter();
  const { user } = useAuth();
  const { tournament, loading } = useTournament(id);

  const [form, setForm] = React.useState<{
    name: string;
    description: string;
    visibility: TournamentVisibility;
    start_date: string;
    end_date: string;
    location_name: string;
    registration_enabled: boolean;
    registration_open: string;
    registration_close: string;
  } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (tournament && !form) {
      setForm({
        name: tournament.name,
        description: tournament.description ?? "",
        visibility: tournament.visibility,
        start_date: tournament.start_date?.slice(0, 10) ?? "",
        end_date: tournament.end_date?.slice(0, 10) ?? "",
        location_name: tournament.location_name ?? "",
        registration_enabled: tournament.registration_enabled,
        registration_open: toDatetimeLocal(tournament.registration_open),
        registration_close: toDatetimeLocal(tournament.registration_close),
      });
    }
  }, [tournament, form]);

  if (loading || !form) return <CenteredSpinner />;
  if (!tournament) return <p className="py-20 text-center text-destructive">Not found</p>;
  if (!user || tournament.created_by !== user.id)
    return <p className="py-20 text-center text-destructive">You can&apos;t edit this tournament.</p>;

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await updateTournament(tournament!.id, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        visibility: form.visibility,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        location_name: form.location_name.trim() || null,
        registration_enabled: form.registration_enabled,
        registration_open: form.registration_enabled
          ? fromDatetimeLocal(form.registration_open)
          : null,
        registration_close: form.registration_enabled
          ? fromDatetimeLocal(form.registration_close)
          : null,
      });
      router.replace(`/tournament/?id=${tournament!.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setSaving(false);
    }
  }

  const set = (patch: Partial<NonNullable<typeof form>>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">Edit tournament</h1>
      <Card className="mt-4 space-y-4 p-5">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date">
            <Input
              type="date"
              value={form.start_date}
              onChange={(e) => {
                const v = e.target.value;
                set(
                  v && form.end_date && form.end_date < v
                    ? { start_date: v, end_date: v }
                    : { start_date: v },
                );
              }}
            />
          </Field>
          <Field label="End date">
            <Input
              type="date"
              value={form.end_date}
              min={form.start_date || undefined}
              disabled={!form.start_date}
              onChange={(e) => set({ end_date: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Location name">
          <Input value={form.location_name} onChange={(e) => set({ location_name: e.target.value })} />
        </Field>
        <Field label="Visibility">
          <Select
            value={form.visibility}
            onChange={(e) => set({ visibility: e.target.value as TournamentVisibility })}
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </Select>
        </Field>
        <div className="space-y-3 rounded-small border border-divider p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={form.registration_enabled}
              onChange={(e) => set({ registration_enabled: e.target.checked })}
              className="accent-[var(--color-accent)]"
            />
            Allow team registration
          </label>
          <p className="text-xs text-text-secondary">
            When on, team captains can register their teams. Leave the dates empty to
            keep registration open indefinitely, or set a window below.
          </p>
          {form.registration_enabled && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Registration opens" hint="Optional">
                <Input
                  type="datetime-local"
                  value={form.registration_open}
                  onChange={(e) => {
                    const v = e.target.value;
                    set(
                      v && form.registration_close && form.registration_close < v
                        ? { registration_open: v, registration_close: v }
                        : { registration_open: v },
                    );
                  }}
                />
              </Field>
              <Field label="Registration closes" hint="Optional">
                <Input
                  type="datetime-local"
                  value={form.registration_close}
                  min={form.registration_open || undefined}
                  onChange={(e) => set({ registration_close: e.target.value })}
                />
              </Field>
            </div>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Spinner /> : "Save changes"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function EditTournamentPage() {
  return (
    <React.Suspense fallback={<CenteredSpinner />}>
      <EditTournament />
    </React.Suspense>
  );
}
