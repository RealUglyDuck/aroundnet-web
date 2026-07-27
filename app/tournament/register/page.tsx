"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, Plus } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useTournament } from "@/lib/hooks/use-tournament";
import { loadRegisteredTeams, listMyTeams } from "@/lib/supabase/queries";
import { registerTeam, setCheckIn } from "@/lib/supabase/mutations";
import type { RegisteredTeam } from "@/lib/types";
import { CreateTeamDialog } from "@/components/create-team-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CenteredSpinner, Spinner } from "@/components/ui/spinner";

function Register() {
  const params = useSearchParams();
  const id = params.get("id");
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tournament, loading } = useTournament(id);

  const [teams, setTeams] = React.useState<RegisteredTeam[]>([]);
  const [myTeams, setMyTeams] = React.useState<{ id: string; name: string }[]>([]);
  const [teamId, setTeamId] = React.useState("");
  const [divisionId, setDivisionId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const refreshTeams = React.useCallback(() => {
    if (id) loadRegisteredTeams(id).then(setTeams).catch(() => {});
  }, [id]);

  const refreshMyTeams = React.useCallback(() => {
    if (user) listMyTeams(user.id).then(setMyTeams).catch(() => {});
  }, [user]);

  React.useEffect(() => refreshTeams(), [refreshTeams]);
  React.useEffect(() => refreshMyTeams(), [refreshMyTeams]);
  React.useEffect(() => {
    if (tournament && tournament.divisions[0]) setDivisionId(tournament.divisions[0].id);
  }, [tournament]);
  React.useEffect(() => {
    if (myTeams[0] && !teamId) setTeamId(myTeams[0].id);
  }, [myTeams, teamId]);

  if (loading || authLoading) return <CenteredSpinner />;
  if (!tournament) return <p className="py-20 text-center text-destructive">Not found</p>;

  const canManage = !!user && tournament.created_by === user.id;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      router.push("/login/");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await registerTeam({
        tournamentId: tournament!.id,
        divisionId: divisionId || null,
        teamId,
      });
      refreshTeams();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to register";
      // The RLS policy blocks registration when it's closed or you're not captain.
      setError(
        /row-level security|policy/i.test(msg)
          ? "Couldn't register — registration may be closed, or you're not this team's captain."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleCheckIn(t: RegisteredTeam) {
    await setCheckIn(t.id, !t.checked_in);
    refreshTeams();
  }

  const divName = (dId: string | null) =>
    tournament.divisions.find((d) => d.id === dId)?.name ?? "—";

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link
        href={`/tournament/?id=${tournament.id}`}
        className="text-sm text-text-secondary hover:text-text-primary"
      >
        ← {tournament.name}
      </Link>
      <h1 className="mt-2 text-2xl font-bold">Register a team</h1>

      <Card className="mt-4 p-5">
        {!user ? (
          <div className="text-center">
            <p className="text-sm text-text-secondary">Sign in to register a team.</p>
            <Button className="mt-3" onClick={() => router.push("/login/")}>
              Sign in
            </Button>
          </div>
        ) : myTeams.length === 0 ? (
          <div className="text-center">
            <p className="text-sm text-text-secondary">
              You don&apos;t have any teams yet. Create one to register.
            </p>
            <Button className="mt-3" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> Create a team
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Your team">
              <div className="flex gap-2">
                <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                  {myTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="secondary" onClick={() => setCreateOpen(true)}>
                  <Plus size={16} />
                </Button>
              </div>
            </Field>
            {tournament.divisions.length > 1 && (
              <Field label="Division">
                <Select value={divisionId} onChange={(e) => setDivisionId(e.target.value)}>
                  {tournament.divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy || !teamId}>
              {busy ? <Spinner /> : "Register team"}
            </Button>
          </form>
        )}
      </Card>

      <h2 className="mt-6 mb-2 text-lg font-semibold">
        Registered teams <span className="text-text-secondary">({teams.length})</span>
      </h2>
      <div className="space-y-2">
        {teams.length === 0 ? (
          <p className="rounded-card bg-surface-high p-6 text-center text-sm text-text-secondary">
            No teams registered yet.
          </p>
        ) : (
          teams.map((t) => (
            <Card key={t.id} className="flex items-center justify-between p-3">
              <div>
                <p className="font-medium">{t.teamName ?? "Team"}</p>
                <p className="text-xs text-text-secondary">{divName(t.division_id)}</p>
              </div>
              <div className="flex items-center gap-2">
                {t.checked_in ? (
                  <Badge tone="success">Checked in</Badge>
                ) : (
                  <Badge tone="neutral">Not checked in</Badge>
                )}
                {canManage && (
                  <button
                    onClick={() => toggleCheckIn(t)}
                    className="text-text-secondary hover:text-accent"
                    title={t.checked_in ? "Undo check-in" : "Check in"}
                  >
                    {t.checked_in ? (
                      <CheckCircle2 size={20} className="text-success" />
                    ) : (
                      <Circle size={20} />
                    )}
                  </button>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(newId) => {
          refreshMyTeams();
          setTeamId(newId);
        }}
      />
    </div>
  );
}

export default function RegisterPage() {
  return (
    <React.Suspense fallback={<CenteredSpinner />}>
      <Register />
    </React.Suspense>
  );
}
