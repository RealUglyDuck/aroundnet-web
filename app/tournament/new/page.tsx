"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Field } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { LocationPicker } from "@/components/location-picker";
import { createTournament, createDivisions } from "@/lib/supabase/mutations";
import { listOrganisationsForUser } from "@/lib/supabase/queries";
import type { TournamentVisibility } from "@/lib/types";

interface DivisionDraft {
  name: string;
  minSize: number;
  maxSize: number;
}

const STEPS = ["Basics", "Divisions", "Registration"];

export default function CreateTournamentPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [step, setStep] = React.useState(0);
  const [orgs, setOrgs] = React.useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Basics
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [visibility, setVisibility] = React.useState<TournamentVisibility>("public");
  const [organiser, setOrganiser] = React.useState("personal");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [location, setLocation] = React.useState<{
    name: string;
    lat: number | null;
    lng: number | null;
  }>({ name: "", lat: null, lng: null });

  // Divisions
  const [divisions, setDivisions] = React.useState<DivisionDraft[]>([
    { name: "Open", minSize: 2, maxSize: 2 },
  ]);

  // Registration
  const [registrationEnabled, setRegistrationEnabled] = React.useState(true);
  const [teamLimit, setTeamLimit] = React.useState("");
  const [regOpen, setRegOpen] = React.useState("");
  const [regClose, setRegClose] = React.useState("");

  React.useEffect(() => {
    if (!authLoading && !user) router.replace("/login/");
  }, [authLoading, user, router]);

  React.useEffect(() => {
    if (user) listOrganisationsForUser(user.id).then(setOrgs).catch(() => {});
  }, [user]);

  function updateDivision(i: number, patch: Partial<DivisionDraft>) {
    setDivisions((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  async function submit() {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const id = await createTournament(
        {
          name: name.trim(),
          description: description.trim() || null,
          visibility,
          organisation_id: organiser === "personal" ? null : organiser,
          start_date: startDate || null,
          end_date: endDate || null,
          location_name: location.name.trim() || null,
          latitude: location.lat,
          longitude: location.lng,
          registration_enabled: registrationEnabled,
          registration_open: regOpen || null,
          registration_close: regClose || null,
          team_limit: teamLimit ? Number(teamLimit) : null,
        },
        user.id,
      );
      await createDivisions(
        id,
        divisions
          .filter((d) => d.name.trim())
          .map((d, i) => ({
            name: d.name.trim(),
            min_team_size: d.minSize,
            max_team_size: d.maxSize,
            sort_order: i,
          })),
      );
      router.replace(`/tournament/?id=${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create tournament");
      setSaving(false);
    }
  }

  const canNext = step === 0 ? name.trim().length > 0 : true;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">New tournament</h1>

      {/* Stepper */}
      <div className="mt-4 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            <div
              className={`flex items-center gap-2 text-sm ${
                i === step ? "text-accent" : "text-text-secondary"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-pill text-xs ${
                  i <= step ? "bg-accent text-background" : "bg-surface border border-divider"
                }`}
              >
                {i + 1}
              </span>
              {label}
            </div>
            {i < STEPS.length - 1 && <div className="h-px flex-1 bg-divider" />}
          </React.Fragment>
        ))}
      </div>

      <Card className="mt-5 p-5">
        {step === 0 && (
          <div className="space-y-4">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nordic Roundnet Series" />
            </Field>
            <Field label="Description">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start date">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    setStartDate(v);
                    // Keep end date valid: never before the start date.
                    if (v && endDate && endDate < v) setEndDate(v);
                  }}
                />
              </Field>
              <Field label="End date">
                <Input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  disabled={!startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-text-primary">Location</span>
              <LocationPicker value={location} onChange={setLocation} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Organiser">
                <Select value={organiser} onChange={(e) => setOrganiser(e.target.value)}>
                  <option value="personal">Personal</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Visibility">
                <Select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as TournamentVisibility)}
                >
                  <option value="public">Public</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="private">Private</option>
                </Select>
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Divisions group teams (e.g. Open, Women&apos;s, Mixed).
            </p>
            {divisions.map((d, i) => (
              <div key={i} className="flex items-end gap-2 rounded-small border border-divider p-3">
                <div className="flex-1">
                  <Field label="Division name">
                    <Input value={d.name} onChange={(e) => updateDivision(i, { name: e.target.value })} />
                  </Field>
                </div>
                <Field label="Min">
                  <Input
                    type="number"
                    min={1}
                    className="w-16"
                    value={d.minSize}
                    onChange={(e) => updateDivision(i, { minSize: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Max">
                  <Input
                    type="number"
                    min={1}
                    className="w-16"
                    value={d.maxSize}
                    onChange={(e) => updateDivision(i, { maxSize: Number(e.target.value) })}
                  />
                </Field>
                {divisions.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDivisions((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 size={16} />
                  </Button>
                )}
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDivisions((prev) => [...prev, { name: "", minSize: 2, maxSize: 2 }])}
            >
              <Plus size={16} /> Add division
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={registrationEnabled}
                onChange={(e) => setRegistrationEnabled(e.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              Enable team registration
            </label>
            <Field label="Team limit" hint="Optional — max teams across the tournament">
              <Input type="number" min={0} value={teamLimit} onChange={(e) => setTeamLimit(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Registration opens">
                <Input type="datetime-local" value={regOpen} onChange={(e) => setRegOpen(e.target.value)} />
              </Field>
              <Field label="Registration closes">
                <Input type="datetime-local" value={regClose} onChange={(e) => setRegClose(e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <div className="mt-6 flex justify-between">
          <Button
            variant="secondary"
            onClick={() => (step === 0 ? router.back() : setStep((s) => s - 1))}
            disabled={saving}
          >
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Next
            </Button>
          ) : (
            <Button onClick={submit} disabled={saving}>
              {saving ? <Spinner /> : "Create tournament"}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
