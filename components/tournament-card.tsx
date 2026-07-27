import Link from "next/link";
import { CalendarDays, MapPin, Lock, EyeOff } from "lucide-react";
import type { TournamentRow } from "@/lib/types";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { formatDateRange } from "@/lib/format";

export function TournamentCard({ t }: { t: TournamentRow }) {
  return (
    <Link href={`/tournament/?id=${t.id}`} className="block">
      <Card className="p-4 transition hover:bg-surface border border-transparent hover:border-divider">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold leading-tight">{t.name}</h3>
          {t.visibility === "private" && (
            <Badge tone="neutral">
              <Lock size={11} className="mr-1" /> Private
            </Badge>
          )}
          {t.visibility === "unlisted" && (
            <Badge tone="neutral">
              <EyeOff size={11} className="mr-1" /> Unlisted
            </Badge>
          )}
        </div>
        <div className="mt-2 space-y-1 text-sm text-text-secondary">
          <p className="flex items-center gap-1.5">
            <CalendarDays size={14} />
            {formatDateRange(t.start_date, t.end_date)}
          </p>
          {t.location_name && (
            <p className="flex items-center gap-1.5">
              <MapPin size={14} />
              {t.location_name}
            </p>
          )}
        </div>
      </Card>
    </Link>
  );
}
