"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LayoutGrid, ListTree, UserPlus, Users } from "lucide-react";
import { useTournament } from "@/lib/hooks/use-tournament";
import { useTournamentPermissions } from "@/lib/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CenteredSpinner } from "@/components/ui/spinner";
import { DivisionStages } from "@/components/division-stages";
import { GroupSetupDialog } from "@/components/day/group-setup-dialog";
import { BracketSetupDialog } from "@/components/day/bracket-setup-dialog";
import type { DivisionVM, MatchVM, TournamentVM } from "@/lib/types";

function DivisionConsole({
  tournament,
  division,
  canEdit,
  canEditMatch,
  reload,
}: {
  tournament: TournamentVM;
  division: DivisionVM;
  /** Organiser rights: create stages/brackets. */
  canEdit: boolean;
  canEditMatch: (match: MatchVM) => boolean;
  reload: () => void;
}) {
  const [groupOpen, setGroupOpen] = React.useState(false);
  const [bracketOpen, setBracketOpen] = React.useState(false);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm text-text-secondary">
          <Users size={15} /> {division.teams.length} teams registered
        </span>
        <div className="flex flex-wrap gap-2">
          <Link href={`/tournament/register/?id=${tournament.id}`}>
            <Button size="sm" variant="secondary">
              <UserPlus size={15} /> Teams
            </Button>
          </Link>
          {canEdit && (
            <>
              <Button size="sm" onClick={() => setGroupOpen(true)}>
                <LayoutGrid size={15} /> Add group stage
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setBracketOpen(true)}>
                <ListTree size={15} /> Add bracket
              </Button>
            </>
          )}
        </div>
      </div>

      <DivisionStages division={division} canEditMatch={canEditMatch} onSubmitted={reload} />

      {canEdit && (
        <>
          <GroupSetupDialog
            tournament={tournament}
            division={division}
            open={groupOpen}
            onOpenChange={setGroupOpen}
            onDone={reload}
          />
          <BracketSetupDialog
            tournament={tournament}
            division={division}
            open={bracketOpen}
            onOpenChange={setBracketOpen}
            onDone={reload}
          />
        </>
      )}
    </div>
  );
}

function DayConsole() {
  const params = useSearchParams();
  const id = params.get("id");
  const { tournament, loading, error, reload } = useTournament(id);
  const { isOrganiser, canEditMatch } = useTournamentPermissions(tournament);

  if (loading) return <CenteredSpinner label="Loading tournament…" />;
  if (error || !tournament)
    return <p className="py-20 text-center text-destructive">{error ?? "Not found"}</p>;

  const canEdit = isOrganiser;
  const divisions = tournament.divisions;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link
        href={`/tournament/?id=${tournament.id}`}
        className="text-sm text-text-secondary hover:text-text-primary"
      >
        ← {tournament.name}
      </Link>
      <h1 className="mt-2 text-2xl font-bold">Tournament Day</h1>
      {!canEdit && (
        <p className="mt-1 text-sm text-text-secondary">
          Live view — organisers manage groups and brackets here; players can enter scores for their own matches once signed in.
        </p>
      )}

      <div className="mt-5">
        {divisions.length === 0 ? (
          <p className="rounded-card bg-surface-high p-6 text-center text-sm text-text-secondary">
            No divisions in this tournament yet.
          </p>
        ) : divisions.length === 1 ? (
          <DivisionConsole
            tournament={tournament}
            division={divisions[0]}
            canEdit={canEdit}
            canEditMatch={canEditMatch}
            reload={reload}
          />
        ) : (
          <Tabs defaultValue={divisions[0].id}>
            <TabsList className="mb-5 flex-wrap">
              {divisions.map((d) => (
                <TabsTrigger key={d.id} value={d.id}>
                  {d.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {divisions.map((d) => (
              <TabsContent key={d.id} value={d.id}>
                <DivisionConsole
                  tournament={tournament}
                  division={d}
                  canEdit={canEdit}
                  canEditMatch={canEditMatch}
                  reload={reload}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  );
}

export default function TournamentDayPage() {
  return (
    <React.Suspense fallback={<CenteredSpinner />}>
      <DayConsole />
    </React.Suspense>
  );
}
