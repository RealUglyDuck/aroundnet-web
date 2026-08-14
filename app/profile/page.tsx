"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Plus, Users, Building2, Crown } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import {
  fetchPlayer,
  listTournaments,
  listMyTeams,
  listOrganisationsForUser,
  listTeamMembers,
  type TeamMemberDetail,
} from "@/lib/supabase/queries";
import { updatePlayerName } from "@/lib/supabase/mutations";
import type { OrgRole, TournamentRow } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TournamentCard } from "@/components/tournament-card";
import { CreateTeamDialog } from "@/components/create-team-dialog";
import { CreateOrgDialog } from "@/components/create-org-dialog";
import { OrganisationMembers } from "@/components/organisation-members";
import { CenteredSpinner, Spinner } from "@/components/ui/spinner";

function TeamCard({ team }: { team: { id: string; name: string } }) {
  const [members, setMembers] = React.useState<TeamMemberDetail[] | null>(null);
  React.useEffect(() => {
    listTeamMembers(team.id).then(setMembers).catch(() => setMembers([]));
  }, [team.id]);
  return (
    <Card className="p-4">
      <p className="font-semibold">{team.name}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {members === null ? (
          <span className="text-xs text-text-secondary">Loading members…</span>
        ) : members.length === 0 ? (
          <span className="text-xs text-text-secondary">No members</span>
        ) : (
          members.map((m) => (
            <Badge key={m.id} tone={m.isCaptain ? "accent" : "neutral"}>
              {m.isCaptain && <Crown size={11} className="mr-1" />}
              {m.name}
            </Badge>
          ))
        )}
      </div>
    </Card>
  );
}

/**
 * Name + email, with the name editable in place.
 *
 * Save is gated on "changed, and both non-empty after trimming" — the same three
 * conditions as iOS OrganizerProfileView. The database cannot enforce the
 * non-empty part: first_name/last_name are NOT NULL, but '' satisfies that.
 */
function ProfileNameCard({
  userId,
  email,
  onSignOut,
}: {
  userId: string;
  email: string | undefined;
  onSignOut: () => void;
}) {
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [stored, setStored] = React.useState<{ first: string; last: string } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancel = false;
    fetchPlayer(userId)
      .then((p) => {
        if (cancel || !p) return;
        setFirstName(p.firstName);
        setLastName(p.lastName);
        setStored({ first: p.firstName, last: p.lastName });
      })
      .catch(() => {
        if (!cancel) setError("Couldn't load your profile.");
      });
    return () => {
      cancel = true;
    };
  }, [userId]);

  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();
  const changed =
    stored !== null && (trimmedFirst !== stored.first || trimmedLast !== stored.last);
  const canSave = changed && !!trimmedFirst && !!trimmedLast && !saving;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await updatePlayerName(userId, trimmedFirst, trimmedLast);
      setFirstName(trimmedFirst);
      setLastName(trimmedLast);
      setStored({ first: trimmedFirst, last: trimmedLast });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save your name");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={save}>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold">Your profile</h1>
          <Button type="button" variant="secondary" size="sm" onClick={onSignOut}>
            <LogOut size={16} /> Sign out
          </Button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={stored === null}
              autoComplete="given-name"
            />
          </Field>
          <Field label="Last name">
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={stored === null}
              autoComplete="family-name"
            />
          </Field>
        </div>

        {email && <p className="mt-3 text-sm text-text-secondary">{email}</p>}

        {changed && !trimmedFirst && !trimmedLast && (
          <p className="mt-2 text-sm text-destructive">Both names are required.</p>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        <div className="mt-3 flex justify-end">
          <Button type="submit" size="sm" disabled={!canSave}>
            {saving ? <Spinner /> : "Save name"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function ProfilePage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [mine, setMine] = React.useState<TournamentRow[] | null>(null);
  const [teams, setTeams] = React.useState<{ id: string; name: string }[]>([]);
  const [orgs, setOrgs] = React.useState<{ id: string; name: string; role: OrgRole }[]>([]);
  const [teamOpen, setTeamOpen] = React.useState(false);
  const [orgOpen, setOrgOpen] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !user) router.replace("/login/");
  }, [loading, user, router]);

  const reloadTeams = React.useCallback(() => {
    if (user) listMyTeams(user.id).then(setTeams).catch(() => {});
  }, [user]);
  const reloadOrgs = React.useCallback(() => {
    if (user) listOrganisationsForUser(user.id).then(setOrgs).catch(() => {});
  }, [user]);

  React.useEffect(() => {
    if (!user) return;
    listTournaments()
      .then((all) => setMine(all.filter((t) => t.created_by === user.id)))
      .catch(() => setMine([]));
    reloadTeams();
    reloadOrgs();
  }, [user, reloadTeams, reloadOrgs]);

  if (loading || !user) return <CenteredSpinner />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <ProfileNameCard
        userId={user.id}
        email={user.email}
        onSignOut={async () => {
          await signOut();
          router.push("/");
        }}
      />

      {/* Teams */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users size={18} /> Your teams
        </h2>
        <Button size="sm" onClick={() => setTeamOpen(true)}>
          <Plus size={16} /> New team
        </Button>
      </div>
      {/* Full-width stacked cards, matching "Your tournaments" below. */}
      <div className="mt-2 space-y-3">
        {teams.length === 0 ? (
          <p className="rounded-card bg-surface-high p-6 text-center text-sm text-text-secondary">
            No teams yet. Create one to register for tournaments.
          </p>
        ) : (
          teams.map((t) => <TeamCard key={t.id} team={t} />)
        )}
      </div>

      {/* Organisations */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Building2 size={18} /> Your organisations
        </h2>
        <Button size="sm" variant="secondary" onClick={() => setOrgOpen(true)}>
          <Plus size={16} /> New organisation
        </Button>
      </div>
      <div className="mt-2 space-y-3">
        {orgs.length === 0 ? (
          <p className="rounded-card bg-surface-high p-6 text-center text-sm text-text-secondary">
            No organisations yet. Organisations can host tournaments.
          </p>
        ) : (
          orgs.map((o) => (
            <Card key={o.id} className="p-4">
              <p className="font-semibold">{o.name}</p>
              <OrganisationMembers
                organisationId={o.id}
                viewerRole={o.role}
                currentUserId={user.id}
              />
            </Card>
          ))
        )}
      </div>

      {/* Tournaments */}
      <h2 className="mt-6 mb-2 text-lg font-semibold">Your tournaments</h2>
      {mine === null ? (
        <CenteredSpinner />
      ) : mine.length === 0 ? (
        <p className="rounded-card bg-surface-high p-6 text-center text-sm text-text-secondary">
          You haven&apos;t created any tournaments yet.
        </p>
      ) : (
        <div className="space-y-3">
          {mine.map((t) => (
            <TournamentCard key={t.id} t={t} />
          ))}
        </div>
      )}

      <CreateTeamDialog open={teamOpen} onOpenChange={setTeamOpen} onCreated={reloadTeams} />
      <CreateOrgDialog open={orgOpen} onOpenChange={setOrgOpen} onCreated={reloadOrgs} />
    </div>
  );
}
