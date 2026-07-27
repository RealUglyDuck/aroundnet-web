import { supabase } from "./client";
import type {
  TournamentRow,
  TournamentVM,
  DivisionVM,
  StageVM,
  GroupVM,
  BracketVM,
  MatchRow,
  SetRow,
  GroupMatchRow,
  BracketMatchRow,
  GroupTeamRow,
  StandingRow,
  TournamentTeamRow,
} from "../types";
import { sortStandings } from "../types";

/** `.in()` blows up conceptually on empty lists — skip the round-trip. */
function nonEmpty<T>(ids: T[]): T[] | null {
  return ids.length ? ids : null;
}

// ── Landing list ─────────────────────────────────────────────────────────────
export async function listTournaments(): Promise<TournamentRow[]> {
  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .order("start_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

// ── Full tournament tree ─────────────────────────────────────────────────────
export async function loadTournament(id: string): Promise<TournamentVM | null> {
  const { data: tournament, error: tErr } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!tournament) return null;

  const [{ data: divisions }, { data: stages }, { data: tournamentTeams }] =
    await Promise.all([
      supabase.from("divisions").select("*").eq("tournament_id", id).order("sort_order"),
      supabase.from("stages").select("*").eq("tournament_id", id).order("sort_order"),
      supabase.from("tournament_teams").select("*").eq("tournament_id", id),
    ]);

  const stageIds = (stages ?? []).map((s) => s.id);

  // Team-name map: tournament_team_id → team name (matches reference tt ids).
  const teamIds = (tournamentTeams ?? []).map((t) => t.team_id);
  const { data: teams } = teamIds.length
    ? await supabase.from("teams").select("id, name").in("id", teamIds)
    : { data: [] as { id: string; name: string }[] };
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const ttNameById = new Map(
    (tournamentTeams ?? []).map((tt) => [tt.id, teamNameById.get(tt.team_id) ?? null]),
  );

  // Stage children.
  const [groupsRes, bracketsRes, groupMatchesRes, bracketMatchesRes] = await Promise.all([
    stageIds.length
      ? supabase.from("groups").select("*").in("stage_id", stageIds).order("sort_order")
      : emptyRes<GroupVM>(),
    stageIds.length
      ? supabase.from("brackets").select("*").in("stage_id", stageIds).order("sort_order")
      : emptyRes<BracketVM>(),
    stageIds.length
      ? supabase.from("group_matches").select("*").in("stage_id", stageIds)
      : emptyRes<GroupMatchRow>(),
    stageIds.length
      ? supabase.from("bracket_matches").select("*").in("stage_id", stageIds)
      : emptyRes<BracketMatchRow>(),
  ]);

  const groups = (groupsRes.data ?? []) as unknown as GroupMatchesGroupRow[];
  const brackets = (bracketsRes.data ?? []) as unknown as BracketRowLite[];
  const groupMatches = (groupMatchesRes.data ?? []) as GroupMatchRow[];
  const bracketMatches = (bracketMatchesRes.data ?? []) as BracketMatchRow[];
  const groupIds = groups.map((g) => g.id);

  // All match ids across group + bracket contexts.
  const matchIds = [
    ...groupMatches.map((m) => m.match_id),
    ...bracketMatches.map((m) => m.match_id),
  ];

  const [matchesRes, setsRes, groupTeamsRes, standingsRes] = await Promise.all([
    matchIds.length
      ? supabase.from("matches").select("*").in("id", matchIds)
      : emptyRes<MatchRow>(),
    matchIds.length
      ? supabase.from("sets").select("*").in("match_id", matchIds).order("set_number")
      : emptyRes<SetRow>(),
    groupIds.length
      ? supabase.from("group_teams").select("*").in("group_id", groupIds).order("seed")
      : emptyRes<GroupTeamRow>(),
    groupIds.length
      ? supabase.from("group_standings").select("*").in("group_id", groupIds)
      : emptyRes<StandingRow>(),
  ]);

  const matchById = new Map((matchesRes.data ?? []).map((m) => [m.id, m as MatchRow]));
  const setsByMatch = groupBy((setsRes.data ?? []) as SetRow[], (s) => s.match_id);
  const groupTeamsByGroup = groupBy(
    (groupTeamsRes.data ?? []) as GroupTeamRow[],
    (gt) => gt.group_id,
  );
  const standingsByGroup = groupBy((standingsRes.data ?? []) as StandingRow[], (s) =>
    s.group_id ?? "",
  );
  const groupMatchByStage = groupBy(groupMatches, (gm) => gm.stage_id);
  const bracketMatchByStage = groupBy(bracketMatches, (bm) => bm.stage_id);
  const groupsByStage = groupBy(groups, (g) => g.stage_id);
  const bracketsByStage = groupBy(brackets, (b) => b.stage_id);

  const name = (ttId: string | null) => (ttId ? ttNameById.get(ttId) ?? null : null);

  const buildMatchVM = (m: MatchRow) => ({
    ...m,
    sets: (setsByMatch.get(m.id) ?? []).sort((a, b) => a.set_number - b.set_number),
    teamAName: name(m.team_a_id),
    teamBName: name(m.team_b_id),
  });

  // ── Compose stages ──
  const stageVMs: StageVM[] = (stages ?? []).map((stage) => {
    const stageGroups: GroupVM[] = (groupsByStage.get(stage.id) ?? []).map((g) => {
      const gms = (groupMatchByStage.get(stage.id) ?? []).filter((gm) => gm.group_id === g.id);
      const matches = gms
        .map((gm) => {
          const m = matchById.get(gm.match_id);
          if (!m) return null;
          return { ...buildMatchVM(m), round: gm.round, position: gm.position, groupId: g.id };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => (a.round ?? 0) - (b.round ?? 0) || (a.position ?? 0) - (b.position ?? 0));
      const teams = (groupTeamsByGroup.get(g.id) ?? []).map((gt) => ({
        ...gt,
        teamName: name(gt.tournament_team_id),
      }));
      return {
        ...g,
        teams,
        matches,
        standings: sortStandings(standingsByGroup.get(g.id) ?? []),
        isComplete: matches.length > 0 && matches.every((m) => m.status === "completed"),
      };
    });

    const stageBrackets: BracketVM[] = (bracketsByStage.get(stage.id) ?? []).map((b) => {
      const bms = (bracketMatchByStage.get(stage.id) ?? []).filter((bm) => bm.bracket_id === b.id);
      const matches = bms
        .map((bm) => {
          const m = matchById.get(bm.match_id);
          if (!m) return null;
          return {
            ...buildMatchVM(m),
            round: bm.round,
            position: bm.position,
            bracketId: b.id,
            bracketGroup: bm.bracket_group,
            teamASourceType: bm.team_a_source_type,
            teamBSourceType: bm.team_b_source_type,
            teamASourceMatchId: bm.team_a_source_match_id,
            teamBSourceMatchId: bm.team_b_source_match_id,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b2) => (a.round ?? 0) - (b2.round ?? 0) || (a.position ?? 0) - (b2.position ?? 0));
      return { ...b, matches };
    });

    return { ...stage, groups: stageGroups, brackets: stageBrackets };
  });

  // ── Compose divisions ──
  const divisionVMs: DivisionVM[] = (divisions ?? []).map((d) => ({
    ...d,
    stages: stageVMs.filter((s) => s.division_id === d.id),
    teams: (tournamentTeams ?? [])
      .filter((tt) => tt.division_id === d.id)
      .map((tt) => ({ ...(tt as TournamentTeamRow), teamName: ttNameById.get(tt.id) ?? null })),
  }));

  const organizerName = await resolveOrganizerName(tournament);

  return { ...tournament, divisions: divisionVMs, organizerName };
}

// ── Registration helpers ─────────────────────────────────────────────────────
export async function loadRegisteredTeams(tournamentId: string) {
  const { data: tts } = await supabase
    .from("tournament_teams")
    .select("*")
    .eq("tournament_id", tournamentId);
  const teamIds = (tts ?? []).map((t) => t.team_id);
  const { data: teams } = teamIds.length
    ? await supabase.from("teams").select("id, name").in("id", teamIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((teams ?? []).map((t) => [t.id, t.name]));
  return (tts ?? []).map((tt) => ({ ...tt, teamName: nameById.get(tt.team_id) ?? null }));
}

// ── Teams owned by the current user (registration + profile) ─────────────────
export async function listMyTeams(
  userId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, name")
    .eq("created_by", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface TeamMemberDetail {
  id: string;
  isCaptain: boolean;
  name: string;
}

export async function listTeamMembers(teamId: string): Promise<TeamMemberDetail[]> {
  const { data } = await supabase
    .from("team_members")
    .select("id, is_captain, players(first_name, last_name, display_name)")
    .eq("team_id", teamId)
    .is("left_at", null);
  return (data ?? []).map((m) => {
    const p = m.players as unknown as {
      first_name: string;
      last_name: string;
      display_name: string | null;
    } | null;
    const name = p
      ? p.display_name || `${p.first_name} ${p.last_name}`.trim() || "Player"
      : "Player";
    return { id: m.id, isCaptain: m.is_captain, name };
  });
}

/** Search players by name to add as team members (requires being signed in). */
export async function searchPlayers(
  query: string,
  excludeId: string,
): Promise<{ id: string; name: string; city: string | null }[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data } = await supabase
    .from("players")
    .select("id, first_name, last_name, display_name, city")
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,display_name.ilike.%${q}%`)
    .neq("id", excludeId)
    .limit(20);
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.display_name || `${p.first_name} ${p.last_name}`.trim() || "Player",
    city: p.city,
  }));
}

// ── Score-editing permissions ────────────────────────────────────────────────

/** True when the player belongs to the organisation that owns the tournament. */
export async function isOrganisationMember(
  organisationId: string,
  playerId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("organisation_members")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("player_id", playerId)
    .maybeSingle();
  return !!data;
}

/** True when the player is organiser-level staff on the tournament. */
export async function isTournamentStaff(
  tournamentId: string,
  playerId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("tournament_staff")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId)
    .in("role", ["organiser", "co_organiser"])
    .maybeSingle();
  return !!data;
}

/**
 * tournament_team ids the player is part of in this tournament — matches
 * reference tournament_team ids, so this is what a match slot is compared to.
 * A player counts via the per-tournament roster, via current team membership,
 * or by having created the team (the web registration flow lists teams that way
 * and doesn't always write a roster).
 */
export async function loadMyTournamentTeamIds(
  tournamentId: string,
  playerId: string,
): Promise<string[]> {
  const { data: tts } = await supabase
    .from("tournament_teams")
    .select("id, team_id")
    .eq("tournament_id", tournamentId);
  if (!tts?.length) return [];

  const ttIds = tts.map((t) => t.id);
  const teamIds = [...new Set(tts.map((t) => t.team_id))];

  const [roster, memberships, owned] = await Promise.all([
    supabase
      .from("tournament_team_roster")
      .select("tournament_team_id")
      .eq("player_id", playerId)
      .in("tournament_team_id", ttIds),
    supabase
      .from("team_members")
      .select("team_id")
      .eq("player_id", playerId)
      .is("left_at", null)
      .in("team_id", teamIds),
    supabase.from("teams").select("id").eq("created_by", playerId).in("id", teamIds),
  ]);

  const myTeamIds = new Set<string>([
    ...(memberships.data ?? []).map((m) => m.team_id),
    ...(owned.data ?? []).map((t) => t.id),
  ]);
  const result = new Set<string>((roster.data ?? []).map((r) => r.tournament_team_id));
  for (const tt of tts) {
    if (myTeamIds.has(tt.team_id)) result.add(tt.id);
  }
  return [...result];
}

// ── Organisations for the current user (organiser selection) ─────────────────
export async function listOrganisationsForUser(
  userId: string,
): Promise<{ id: string; name: string }[]> {
  const { data: memberships } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("player_id", userId);
  const ids = (memberships ?? []).map((m) => m.organisation_id);
  if (!ids.length) return [];
  const { data } = await supabase
    .from("organisations")
    .select("id, name")
    .in("id", ids)
    .order("name");
  return data ?? [];
}

// ── internal ─────────────────────────────────────────────────────────────────
async function resolveOrganizerName(t: TournamentRow): Promise<string | null> {
  if (t.organisation_id) {
    const { data } = await supabase
      .from("organisations")
      .select("name")
      .eq("id", t.organisation_id)
      .maybeSingle();
    return data?.name ?? null;
  }
  const { data } = await supabase
    .from("players")
    .select("display_name, first_name, last_name")
    .eq("id", t.created_by)
    .maybeSingle();
  if (!data) return null;
  return data.display_name || `${data.first_name} ${data.last_name}`.trim() || null;
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of arr) {
    const k = key(item);
    const list = m.get(k);
    if (list) list.push(item);
    else m.set(k, [item]);
  }
  return m;
}

function emptyRes<T>() {
  return Promise.resolve({ data: [] as T[], error: null });
}

// Loosely-typed helpers for the intermediate joins.
type GroupMatchesGroupRow = GroupVM & { stage_id: string; id: string };
type BracketRowLite = BracketVM & { stage_id: string; id: string };
void nonEmpty;
