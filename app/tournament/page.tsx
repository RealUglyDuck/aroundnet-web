"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CalendarDays,
  CalendarMinus,
  CalendarPlus,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { useTournament } from "@/lib/hooks/use-tournament";
import { useTournamentPermissions } from "@/lib/hooks/use-permissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CenteredSpinner } from "@/components/ui/spinner";
import { DivisionTeamsPanel } from "@/components/division-teams-panel";
import { AddDivisionDialog } from "@/components/add-division-dialog";
import type { TournamentVM } from "@/lib/types";
import { formatDateRange, formatDateTime, registrationStatus } from "@/lib/format";

function TournamentDetail() {
  const params = useSearchParams();
  const id = params.get("id");
  const { tournament, loading, error, reload } = useTournament(id);
  const { isOrganiser } = useTournamentPermissions(tournament);
  const [addDivisionOpen, setAddDivisionOpen] = React.useState(false);

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
          {/* Register team lives in the Registration card below, next to the
              window and capacity you'd weigh before entering. */}
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

      {/* Above About: this now carries the Register action, and an entrant
          shouldn't have to scroll past the description to find it. Matches the
          iOS order, where registration sits directly under Tournament Day. */}
      <RegistrationCard tournament={tournament} showWhenOff={canEdit} />

      {tournament.description && (
        <Card className="mt-4 p-5">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-secondary">
            About
          </h2>
          <p className="whitespace-pre-wrap text-sm">{tournament.description}</p>
        </Card>
      )}

      {/* Divisions — who is registered. Groups, brackets, standings and score
          entry deliberately live on Tournament Day, not here. */}
      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Divisions
          </h2>
          {canEdit && (
            <Button size="sm" variant="secondary" onClick={() => setAddDivisionOpen(true)}>
              <Plus size={15} /> Add division
            </Button>
          )}
        </div>

        {divisions.length === 0 ? (
          <p className="rounded-card bg-surface-high p-6 text-center text-sm text-text-secondary">
            {canEdit
              ? "No divisions yet — add one to open the tournament for registration."
              : "No divisions yet."}
          </p>
        ) : divisions.length === 1 ? (
          <DivisionTeamsPanel division={divisions[0]} title={divisions[0].name} />
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
                <DivisionTeamsPanel division={d} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>

      {canEdit && (
        <AddDivisionDialog
          tournament={tournament}
          open={addDivisionOpen}
          onOpenChange={setAddDivisionOpen}
          onDone={reload}
        />
      )}
    </div>
  );
}

const REGISTRATION_TONE = {
  open: "success",
  not_yet: "accent",
  closed: "neutral",
  disabled: "neutral",
} as const;

const REGISTRATION_TEXT = {
  open: "Open now",
  not_yet: "Not open yet",
  closed: "Closed",
  disabled: "Not accepting teams",
} as const;

/**
 * The registration window. Hidden entirely when registration is switched off,
 * since it is then just noise — except for organisers (`showWhenOff`), who need
 * to see that it is off in order to go and turn it on.
 */
function RegistrationCard({
  tournament,
  showWhenOff,
}: {
  tournament: TournamentVM;
  showWhenOff: boolean;
}) {
  const status = registrationStatus(tournament);
  if (status === "disabled" && !showWhenOff) return null;

  const opens = tournament.registration_open;
  const closes = tournament.registration_close;
  const registeredTeams = tournament.divisions.reduce((n, d) => n + d.teams.length, 0);

  return (
    <Card className="mt-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Registration
        </h2>
        <Badge tone={REGISTRATION_TONE[status]}>{REGISTRATION_TEXT[status]}</Badge>
      </div>

      {status === "disabled" ? (
        <p className="mt-3 text-sm text-text-secondary">
          Teams can&apos;t register yet. Turn it on under Edit to open sign-ups.
        </p>
      ) : (
        <>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 sm:justify-start sm:gap-2">
              <dt className="flex items-center gap-1.5 text-text-secondary">
                <CalendarPlus size={15} /> Opens
              </dt>
              <dd>{opens ? formatDateTime(opens) : "Already open"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-start sm:gap-2">
              <dt className="flex items-center gap-1.5 text-text-secondary">
                <CalendarMinus size={15} /> Closes
              </dt>
              <dd>{closes ? formatDateTime(closes) : "No closing date"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-start sm:gap-2">
              <dt className="flex items-center gap-1.5 text-text-secondary">
                <Users size={15} /> Teams
              </dt>
              <dd>
                {registeredTeams}
                {tournament.team_limit != null && ` of ${tournament.team_limit}`} registered
              </dd>
            </div>
          </dl>

          {/* Only in the `open` state — the same predicate that gates the
              tournament_teams RLS policy, so the button never offers something
              the database will reject. */}
          {status === "open" && (
            <Link
              href={`/tournament/register/?id=${tournament.id}`}
              className="mt-4 block"
            >
              <Button size="sm">
                <UserPlus size={16} /> Register team
              </Button>
            </Link>
          )}
        </>
      )}
    </Card>
  );
}

export default function TournamentDetailPage() {
  return (
    <React.Suspense fallback={<CenteredSpinner />}>
      <TournamentDetail />
    </React.Suspense>
  );
}
