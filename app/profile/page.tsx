"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Plus, Users, Building2, Crown } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import {
  listTournaments,
  listMyTeams,
  listOrganisationsForUser,
  listTeamMembers,
  type TeamMemberDetail,
} from "@/lib/supabase/queries";
import type { TournamentRow } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TournamentCard } from "@/components/tournament-card";
import { CreateTeamDialog } from "@/components/create-team-dialog";
import { CreateOrgDialog } from "@/components/create-org-dialog";
import { CenteredSpinner } from "@/components/ui/spinner";

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

export default function ProfilePage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [mine, setMine] = React.useState<TournamentRow[] | null>(null);
  const [teams, setTeams] = React.useState<{ id: string; name: string }[]>([]);
  const [orgs, setOrgs] = React.useState<{ id: string; name: string }[]>([]);
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
      <Card className="flex items-center justify-between p-5">
        <div>
          <h1 className="text-xl font-bold">Your profile</h1>
          <p className="text-sm text-text-secondary">{user.email}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            await signOut();
            router.push("/");
          }}
        >
          <LogOut size={16} /> Sign out
        </Button>
      </Card>

      {/* Teams */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users size={18} /> Your teams
        </h2>
        <Button size="sm" onClick={() => setTeamOpen(true)}>
          <Plus size={16} /> New team
        </Button>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {teams.length === 0 ? (
          <p className="rounded-card bg-surface-high p-6 text-center text-sm text-text-secondary sm:col-span-2">
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
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {orgs.length === 0 ? (
          <p className="rounded-card bg-surface-high p-6 text-center text-sm text-text-secondary sm:col-span-2">
            No organisations yet. Organisations can host tournaments.
          </p>
        ) : (
          orgs.map((o) => (
            <Card key={o.id} className="p-4">
              <p className="font-semibold">{o.name}</p>
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
