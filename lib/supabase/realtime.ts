import { supabase } from "./client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Subscribe to live tournament changes. matches/sets carry no tournament_id, so
 * we listen broadly to the score-bearing tables and debounce a reload; the
 * stage/group/bracket tables are filtered where a usable column exists.
 * Returns an unsubscribe function.
 */
export function subscribeTournament(
  tournamentId: string,
  onChange: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 250);
  };

  const channel: RealtimeChannel = supabase.channel(`tournament:${tournamentId}`);

  // Score-bearing tables — no tournament_id column, listen to all changes.
  for (const table of ["matches", "sets", "group_matches", "bracket_matches"]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, debounced);
  }
  // Structural tables filtered by tournament.
  for (const table of ["stages", "divisions", "tournament_teams"]) {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `tournament_id=eq.${tournamentId}` },
      debounced,
    );
  }
  // groups/brackets key off stage_id — caught via the broad match listeners on
  // regeneration; also listen unfiltered to be safe.
  for (const table of ["groups", "brackets"]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, debounced);
  }

  channel.subscribe();

  return () => {
    if (timer) clearTimeout(timer);
    supabase.removeChannel(channel);
  };
}
