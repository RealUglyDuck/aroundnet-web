"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays, MapPin, Navigation, Pencil, Trophy, UserPlus } from "lucide-react";
import { useTournament } from "@/lib/hooks/use-tournament";
import { useTournamentPermissions } from "@/lib/hooks/use-permissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CenteredSpinner } from "@/components/ui/spinner";
import { DivisionStages } from "@/components/division-stages";
import { DivisionTeamsPanel } from "@/components/division-teams-panel";
import type { DivisionVM, MatchVM } from "@/lib/types";
import { formatDateRange } from "@/lib/format";

function TournamentDetail() {
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
      <Link href="/" className="text-sm text-text-secondary hover:text-text-primary">
        ← All tournaments
      </Link>

      {/* Header */}
      <Card className="mt-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{tournament.name}</h1>
            {tournament.organizerName && (
              <p className="mt-1 text-sm text-text-secondary">
                by {tournament.organizerName}
              </p>
            )}
          </div>
          {tournament.visibility !== "public" && (
            <Badge tone="neutral" className="capitalize">
              {tournament.visibility}
            </Badge>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-text-secondary">
          <span className="flex items-center gap-1.5">
            <CalendarDays size={15} />
            {formatDateRange(tournament.start_date, tournament.end_date)}
          </span>
          {tournament.location_name && (
            <span className="flex items-center gap-1.5">
              <MapPin size={15} />
              {tournament.location_name}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/tournament/day/?id=${tournament.id}`}>
            <Button size="sm">
              <Trophy size={16} /> Tournament Day
            </Button>
          </Link>
          {tournament.registration_enabled && (
            <Link href={`/tournament/register/?id=${tournament.id}`}>
              <Button size="sm" variant="secondary">
                <UserPlus size={16} /> Register team
              </Button>
            </Link>
          )}
          {tournament.latitude != null && tournament.longitude != null && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${tournament.latitude},${tournament.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="sm" variant="secondary">
                <Navigation size={16} /> Directions
              </Button>
            </a>
          )}
          {canEdit && (
            <Link href={`/tournament/edit/?id=${tournament.id}`}>
              <Button size="sm" variant="ghost">
                <Pencil size={16} /> Edit
              </Button>
            </Link>
          )}
        </div>
      </Card>

      {tournament.description && (
        <Card className="mt-4 p-5">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-secondary">
            About
          </h2>
          <p className="whitespace-pre-wrap text-sm">{tournament.description}</p>
        </Card>
      )}

      {/* Divisions */}
      <div className="mt-6">
        {divisions.length === 0 ? (
          <p className="rounded-card bg-surface-high p-6 text-center text-sm text-text-secondary">
            No divisions yet.
          </p>
        ) : divisions.length === 1 ? (
          <>
            <h2 className="mb-3 text-lg font-semibold">
              {divisions[0].name}
              <span className="ml-2 text-sm font-normal text-text-secondary">
                {divisions[0].teams.length} teams
              </span>
            </h2>
            <DivisionLayout division={divisions[0]} tournamentId={tournament.id} showRegister={tournament.registration_enabled} reload={reload} canEditMatch={canEditMatch} />
          </>
        ) : (
          <Tabs defaultValue={divisions[0].id}>
            <TabsList className="mb-4 flex-wrap">
              {divisions.map((d) => (
                <TabsTrigger key={d.id} value={d.id}>
                  {d.name}
                  <span className="ml-1.5 rounded-pill bg-black/20 px-1.5 text-xs">
                    {d.teams.length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            {divisions.map((d) => (
              <TabsContent key={d.id} value={d.id}>
                <DivisionLayout division={d} tournamentId={tournament.id} showRegister={tournament.registration_enabled} reload={reload} canEditMatch={canEditMatch} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  );
}

function DivisionLayout({
  division,
  tournamentId,
  showRegister,
  reload,
  canEditMatch,
}: {
  division: DivisionVM;
  tournamentId: string;
  showRegister: boolean;
  reload: () => void;
  canEditMatch: (match: MatchVM) => boolean;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <DivisionStages division={division} canEditMatch={canEditMatch} onSubmitted={reload} />
      </div>
      <div className="lg:sticky lg:top-20 lg:self-start">
        <DivisionTeamsPanel
          division={division}
          tournamentId={tournamentId}
          showRegister={showRegister}
        />
      </div>
    </div>
  );
}

export default function TournamentDetailPage() {
  return (
    <React.Suspense fallback={<CenteredSpinner />}>
      <TournamentDetail />
    </React.Suspense>
  );
}
