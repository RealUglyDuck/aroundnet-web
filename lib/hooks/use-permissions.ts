"use client";

import * as React from "react";
import { useAuth } from "@/components/auth-provider";
import {
  isOrganisationMember,
  isTournamentStaff,
  loadMyTournamentTeamIds,
} from "@/lib/supabase/queries";
import type { MatchVM, TournamentVM } from "@/lib/types";

export interface TournamentPermissions {
  /** Creator, a member of the owning organisation, or organiser-level staff. */
  isOrganiser: boolean;
  /** tournament_team ids the signed-in player plays for in this tournament. */
  myTeamIds: Set<string>;
  /** Organisers may score any match; players only the ones they play in. */
  canEditMatch: (match: MatchVM) => boolean;
  loading: boolean;
}

interface Resolved {
  /** `${tournamentId}:${userId}` the memberships below were fetched for. */
  key: string;
  organiserSide: boolean;
  teamIds: Set<string>;
}

const NO_TEAMS: Set<string> = new Set();

/**
 * Who may enter scores: the organiser side (tournament creator, organiser or
 * co-organiser staff, any member of the owning organisation) and the players of
 * the two teams in the match. This mirrors the SQL predicates
 * `is_tournament_organiser` / `is_match_player`, which is what the submit-score
 * edge function and the RLS policies actually enforce — keep the two in step.
 *
 * Memberships are resolved once per tournament + user, not on every realtime
 * reload, so the effect keys off ids rather than the tournament object.
 */
export function useTournamentPermissions(
  tournament: TournamentVM | null,
): TournamentPermissions {
  const { user } = useAuth();
  const tournamentId = tournament?.id ?? null;
  const organisationId = tournament?.organisation_id ?? null;
  const userId = user?.id ?? null;
  const isCreator = !!userId && tournament?.created_by === userId;

  const key = tournamentId && userId ? `${tournamentId}:${userId}` : null;
  const [resolved, setResolved] = React.useState<Resolved | null>(null);
  // Ignore memberships fetched for a different tournament/user.
  const current = resolved && resolved.key === key ? resolved : null;

  React.useEffect(() => {
    if (!tournamentId || !userId || !key) return;
    let cancelled = false;
    (async () => {
      const [orgMember, staff, teamIds] = await Promise.all([
        organisationId ? isOrganisationMember(organisationId, userId) : Promise.resolve(false),
        isTournamentStaff(tournamentId, userId),
        loadMyTournamentTeamIds(tournamentId, userId),
      ]);
      if (!cancelled) {
        setResolved({ key, organiserSide: orgMember || staff, teamIds: new Set(teamIds) });
      }
    })().catch(() => {
      // A failed lookup just means no extra rights beyond being the creator.
      if (!cancelled) setResolved({ key, organiserSide: false, teamIds: new Set() });
    });
    return () => {
      cancelled = true;
    };
  }, [tournamentId, organisationId, userId, key]);

  const isOrganiser = isCreator || (current?.organiserSide ?? false);
  const myTeamIds = current?.teamIds ?? NO_TEAMS;

  const canEditMatch = React.useCallback(
    (match: MatchVM) => {
      if (!userId || match.is_bye) return false;
      if (isOrganiser) return true;
      return (
        (match.team_a_id != null && myTeamIds.has(match.team_a_id)) ||
        (match.team_b_id != null && myTeamIds.has(match.team_b_id))
      );
    },
    [userId, isOrganiser, myTeamIds],
  );

  return { isOrganiser, myTeamIds, canEditMatch, loading: key != null && current == null };
}
