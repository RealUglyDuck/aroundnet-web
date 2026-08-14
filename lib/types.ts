import type { Database } from "./supabase/database.types";

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];
export type Enums = Database["public"]["Enums"];

// ── Row aliases ──────────────────────────────────────────────────────────────
export type TournamentRow = Tables["tournaments"]["Row"];
export type DivisionRow = Tables["divisions"]["Row"];
export type StageRow = Tables["stages"]["Row"];
export type GroupRow = Tables["groups"]["Row"];
export type GroupTeamRow = Tables["group_teams"]["Row"];
export type BracketRow = Tables["brackets"]["Row"];
export type MatchRow = Tables["matches"]["Row"];
export type SetRow = Tables["sets"]["Row"];
export type GroupMatchRow = Tables["group_matches"]["Row"];
export type BracketMatchRow = Tables["bracket_matches"]["Row"];
export type TournamentTeamRow = Tables["tournament_teams"]["Row"];
export type TeamRow = Tables["teams"]["Row"];
export type PlayerRow = Tables["players"]["Row"];
export type OrganisationRow = Tables["organisations"]["Row"];
export type OrganisationMemberRow = Tables["organisation_members"]["Row"];
export type StandingRow = Views["group_standings"]["Row"];

export type StageType = Enums["stage_type"];
export type MatchStatus = Enums["match_status"];
export type BracketType = Enums["bracket_type"];
export type SlotSourceType = Enums["slot_source_type"];
export type TournamentVisibility = Enums["tournament_visibility"];
export type OrgRole = Enums["org_role"];

// ── Composed view models (hydrated client-side, mirrors iOS TournamentStore) ──
export interface MatchVM extends MatchRow {
  sets: SetRow[];
  /** Registered-team display names for A/B, or null for empty/bye slots. */
  teamAName: string | null;
  teamBName: string | null;
}

export interface GroupMatchVM extends MatchVM {
  round: number | null;
  position: number | null;
  groupId: string;
}

export interface BracketMatchVM extends MatchVM {
  round: number | null;
  position: number | null;
  bracketId: string;
  bracketGroup: string | null;
  teamASourceType: SlotSourceType | null;
  teamBSourceType: SlotSourceType | null;
  teamASourceMatchId: string | null;
  teamBSourceMatchId: string | null;
}

export interface GroupVM extends GroupRow {
  teams: (GroupTeamRow & { teamName: string | null })[];
  matches: GroupMatchVM[];
  standings: StandingRow[];
  isComplete: boolean;
}

export interface BracketVM extends BracketRow {
  matches: BracketMatchVM[];
}

export interface StageVM extends StageRow {
  groups: GroupVM[];
  brackets: BracketVM[];
}

export interface DivisionVM extends DivisionRow {
  stages: StageVM[];
  /** tournament_teams registered into this division, with team and player names. */
  teams: (TournamentTeamRow & { teamName: string | null; playerNames: string[] })[];
}

export interface TournamentVM extends TournamentRow {
  divisions: DivisionVM[];
  organizerName: string | null;
}

/** Team-registration record joined with its team name. */
export interface RegisteredTeam extends TournamentTeamRow {
  teamName: string | null;
}

// ── Scoring defaults (Roundnet) ──────────────────────────────────────────────
export const SCORING_DEFAULTS = { pointsToWin: 21, hardCap: 25, bestOf: 3 };

export function stageSettingsSummary(s: {
  points_to_win: number;
  hard_cap: number;
  best_of: number;
}): string {
  return `${s.points_to_win} pts · cap ${s.hard_cap} · Best of ${s.best_of}`;
}

/** Tie-break sort mirroring the group_standings view: wins DESC, point_diff DESC. */
export function sortStandings(rows: StandingRow[]): StandingRow[] {
  return [...rows].sort((a, b) => {
    const aw = a.wins ?? 0;
    const bw = b.wins ?? 0;
    if (bw !== aw) return bw - aw;
    return (b.point_diff ?? 0) - (a.point_diff ?? 0);
  });
}
