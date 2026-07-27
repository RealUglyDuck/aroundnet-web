"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { listTournaments } from "@/lib/supabase/queries";
import type { TournamentRow } from "@/lib/types";
import { isUpcoming } from "@/lib/format";
import { useAuth } from "@/components/auth-provider";
import { TournamentCard } from "@/components/tournament-card";
import { TournamentMap, type MapPoint } from "@/components/tournament-map";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { CenteredSpinner } from "@/components/ui/spinner";

type Filter = "all" | "upcoming" | "mine";

export default function HomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [tournaments, setTournaments] = React.useState<TournamentRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");

  React.useEffect(() => {
    listTournaments()
      .then(setTournaments)
      .catch((e) => setError(e.message ?? "Failed to load tournaments"));
  }, []);

  const filtered = React.useMemo(() => {
    if (!tournaments) return [];
    const q = query.trim().toLowerCase();
    return tournaments.filter((t) => {
      if (
        q &&
        !t.name.toLowerCase().includes(q) &&
        !(t.location_name ?? "").toLowerCase().includes(q)
      )
        return false;
      if (filter === "upcoming" && !isUpcoming(t.start_date, t.end_date)) return false;
      if (filter === "mine" && t.created_by !== user?.id) return false;
      return true;
    });
  }, [tournaments, query, filter, user?.id]);

  const points: MapPoint[] = React.useMemo(
    () =>
      filtered
        .filter((t) => t.latitude != null && t.longitude != null)
        .map((t) => ({ id: t.id, name: t.name, lat: t.latitude!, lng: t.longitude! })),
    [filtered],
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Tournaments</h1>
          <p className="text-sm text-text-secondary">Find and run Roundnet tournaments.</p>
        </div>
        <Button
          onClick={() => router.push(user ? "/tournament/new/" : "/login/")}
          className="shrink-0"
        >
          <Plus size={18} /> Create
        </Button>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
          />
          <Input
            className="pl-9"
            placeholder="Search tournaments or places"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Chip selected={filter === "all"} onClick={() => setFilter("all")}>
            All
          </Chip>
          <Chip selected={filter === "upcoming"} onClick={() => setFilter("upcoming")}>
            Upcoming
          </Chip>
          {user && (
            <Chip selected={filter === "mine"} onClick={() => setFilter("mine")}>
              My Tournaments
            </Chip>
          )}
        </div>
      </div>

      {error ? (
        <p className="mt-10 text-center text-destructive">{error}</p>
      ) : tournaments === null ? (
        <CenteredSpinner label="Loading tournaments…" />
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
          <div className="order-2 space-y-3 lg:order-1">
            {filtered.length === 0 ? (
              <p className="rounded-card bg-surface-high p-8 text-center text-text-secondary">
                No tournaments match your filters.
              </p>
            ) : (
              filtered.map((t) => <TournamentCard key={t.id} t={t} />)
            )}
          </div>
          <div className="order-1 h-[320px] lg:sticky lg:top-20 lg:order-2 lg:h-[calc(100vh-7rem)]">
            <TournamentMap
              points={points}
              onSelect={(id) => router.push(`/tournament/?id=${id}`)}
              className="h-full w-full overflow-hidden rounded-card border border-divider"
            />
          </div>
        </div>
      )}
    </div>
  );
}
