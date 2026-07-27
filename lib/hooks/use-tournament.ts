"use client";

import * as React from "react";
import { loadTournament } from "@/lib/supabase/queries";
import { subscribeTournament } from "@/lib/supabase/realtime";
import type { TournamentVM } from "@/lib/types";

export function useTournament(id: string | null) {
  const [tournament, setTournament] = React.useState<TournamentVM | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    if (!id) return;
    try {
      const t = await loadTournament(id);
      setTournament(t);
      if (!t) setError("Tournament not found.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tournament");
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    reload();
    const unsub = subscribeTournament(id, reload);
    return unsub;
  }, [id, reload]);

  return { tournament, loading, error, reload, setTournament };
}
