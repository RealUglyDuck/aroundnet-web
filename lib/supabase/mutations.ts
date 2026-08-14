import { supabase } from "./client";
import type { TournamentVisibility } from "../types";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "tournament"}-${suffix}`;
}

export interface CreateTournamentInput {
  name: string;
  description?: string | null;
  visibility: TournamentVisibility;
  location_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  organisation_id?: string | null;
  registration_enabled?: boolean;
  registration_open?: string | null;
  registration_close?: string | null;
  team_limit?: number | null;
  // No team size here on purpose — roster size is a property of the division
  // (Open might be pairs, a Mixed division a trio), so it lives only there.
}

export async function createTournament(
  input: CreateTournamentInput,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("tournaments")
    .insert({
      name: input.name,
      slug: slugify(input.name),
      description: input.description ?? null,
      sport: "roundnet",
      visibility: input.visibility,
      location_name: input.location_name ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      organisation_id: input.organisation_id ?? null,
      registration_enabled: input.registration_enabled ?? true,
      registration_open: input.registration_open ?? null,
      registration_close: input.registration_close ?? null,
      team_limit: input.team_limit ?? null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateTournament(
  id: string,
  patch: Partial<CreateTournamentInput>,
) {
  const { error } = await supabase.from("tournaments").update(patch).eq("id", id);
  if (error) throw error;
}

export interface DivisionInput {
  name: string;
  description?: string | null;
  min_team_size?: number;
  max_team_size?: number;
  team_limit?: number | null;
  sort_order: number;
}

export async function createDivisions(tournamentId: string, divisions: DivisionInput[]) {
  if (!divisions.length) return;
  const rows = divisions.map((d) => ({
    tournament_id: tournamentId,
    name: d.name,
    description: d.description ?? null,
    min_team_size: d.min_team_size ?? 2,
    max_team_size: d.max_team_size ?? 2,
    team_limit: d.team_limit ?? null,
    sort_order: d.sort_order,
  }));
  const { error } = await supabase.from("divisions").insert(rows);
  if (error) throw error;
}

// ── Teams ────────────────────────────────────────────────────────────────────
/** Create a team owned by the user and add them as captain (mirrors iOS createTeam). */
export async function createTeam(name: string, userId: string): Promise<string> {
  const { data: team, error: teamErr } = await supabase
    .from("teams")
    .insert({ name: name.trim(), created_by: userId })
    .select("id")
    .single();
  if (teamErr) throw teamErr;
  const { error: memberErr } = await supabase
    .from("team_members")
    .insert({ team_id: team.id, player_id: userId, is_captain: true });
  if (memberErr) throw memberErr;
  return team.id;
}

export async function addTeamMember(teamId: string, playerId: string) {
  const { error } = await supabase
    .from("team_members")
    .insert({ team_id: teamId, player_id: playerId, is_captain: false });
  if (error) throw error;
}

// ── Own profile ──────────────────────────────────────────────────────────────
/**
 * Rename yourself. Guarded by "Players: users can update own profile"
 * (`using (id = auth.uid())`, reused as the check since there is no WITH CHECK),
 * so this can only ever touch your own row.
 *
 * Deliberately does NOT write display_name: it is GENERATED ALWAYS from these two
 * columns, so Postgres rejects any attempt to set it — and leaving it alone is
 * what makes a rename show up instantly in rosters, member lists and search.
 */
export async function updatePlayerName(
  userId: string,
  firstName: string,
  lastName: string,
) {
  const { error } = await supabase
    .from("players")
    .update({ first_name: firstName.trim(), last_name: lastName.trim() })
    .eq("id", userId);
  if (error) throw error;
}

// ── Organisations ────────────────────────────────────────────────────────────
/** Create an organisation and add the creator as owner (mirrors iOS createOrganisation). */
export async function createOrganisation(
  name: string,
  slug: string,
  userId: string,
): Promise<string> {
  const { data: org, error: orgErr } = await supabase
    .from("organisations")
    .insert({ name: name.trim(), slug: slug.trim(), created_by: userId })
    .select("id")
    .single();
  if (orgErr) throw orgErr;
  const { error: memberErr } = await supabase
    .from("organisation_members")
    .insert({ organisation_id: org.id, player_id: userId, role: "owner" });
  if (memberErr) throw memberErr;
  return org.id;
}

/**
 * Add someone to an organisation as a plain member, matching iOS's
 * addMember(role: .member).
 *
 * Only callable once the caller is already an owner/admin of the org: the
 * "Org members: owners/admins can manage" policy reads is_org_admin(), which in
 * turn reads organisation_members. Straight after createOrganisation that is
 * satisfied by the owner row it just inserted — so this must run after it, never
 * alongside it.
 */
export async function addOrganisationMember(organisationId: string, playerId: string) {
  const { error } = await supabase
    .from("organisation_members")
    .insert({ organisation_id: organisationId, player_id: playerId, role: "member" });
  if (error) throw error;
}

/** Remove a membership by its own row id. */
export async function removeOrganisationMember(memberRowId: string) {
  const { error } = await supabase
    .from("organisation_members")
    .delete()
    .eq("id", memberRowId);
  if (error) throw error;
}

// ── Registration ─────────────────────────────────────────────────────────────
/** Register an EXISTING team (the user must be its captain) into a division. */
export async function registerTeam(params: {
  tournamentId: string;
  divisionId: string | null;
  teamId: string;
}): Promise<string> {
  const { data: tt, error } = await supabase
    .from("tournament_teams")
    .insert({
      tournament_id: params.tournamentId,
      team_id: params.teamId,
      division_id: params.divisionId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return tt.id;
}

export async function setCheckIn(tournamentTeamId: string, checkedIn: boolean) {
  const { error } = await supabase
    .from("tournament_teams")
    .update({
      checked_in: checkedIn,
      checked_in_at: checkedIn ? new Date().toISOString() : null,
    })
    .eq("id", tournamentTeamId);
  if (error) throw error;
}
