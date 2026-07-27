import { supabase } from "./client";

/**
 * Typed wrappers around the shared Supabase edge functions. These hold ALL the
 * tournament logic (bracket generation, round-robin scheduling, score
 * propagation) — the same functions the iOS app calls. supabase-js attaches the
 * logged-in user's JWT automatically; the functions 401 without a session.
 */

async function invoke<T>(name: string, body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, {
    body: body as Record<string, unknown>,
  });
  if (error) {
    // Edge functions return { error, details } JSON on failure.
    const ctx = (error as { context?: Response }).context;
    let detail = error.message;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = await ctx.json();
        detail = j.error ? `${j.error}${j.details ? `: ${j.details}` : ""}` : detail;
      } catch {
        /* ignore */
      }
    }
    throw new Error(detail);
  }
  return data as T;
}

// ── generate-group-matches ───────────────────────────────────────────────────
export interface GroupInput {
  name: string;
  tournament_team_ids: string[];
}

export interface GenerateGroupMatchesInput {
  tournament_id: string;
  division_id: string;
  stage_id?: string; // add groups to an existing stage
  stage_name?: string;
  points_to_win?: number;
  hard_cap?: number;
  best_of?: number;
  games_per_matchup?: number;
  groups: GroupInput[];
}

export function generateGroupMatches(input: GenerateGroupMatchesInput) {
  return invoke<{
    stage: { id: string };
    groups: { id: string; name: string; team_count: number; match_count: number }[];
    total_matches: number;
  }>("generate-group-matches", input);
}

// ── generate-bracket ─────────────────────────────────────────────────────────
export interface GenerateBracketInput {
  tournament_id: string;
  division_id: string;
  source_stage_ids: string[];
  stage_name?: string;
  bracket_count?: 1 | 2;
  top_bracket_size?: number; // required when bracket_count === 2
  best_of?: number;
  points_to_win?: number;
  hard_cap?: number;
}

export function generateBracket(input: GenerateBracketInput) {
  return invoke<{
    stage: { id: string };
    bracket_groups: {
      brackets: {
        id: string;
        name: string;
        position_start: number | null;
        position_end: number | null;
        sort_order: number;
      }[];
      match_count: number;
    }[];
  }>("generate-bracket", input);
}

// ── submit-score ─────────────────────────────────────────────────────────────
export interface SubmitScoreInput {
  match_id: string;
  set_number: number;
  score_a: number;
  score_b: number;
}

export function submitScore(input: SubmitScoreInput) {
  return invoke<{
    match_id: string;
    is_complete: boolean;
    winner_id: string | null;
    loser_id: string | null;
    wins_a: number;
    wins_b: number;
    sets_to_win: number;
  }>("submit-score", input);
}
