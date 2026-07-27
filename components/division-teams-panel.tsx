import Link from "next/link";
import { CheckCircle2, UserPlus } from "lucide-react";
import type { DivisionVM } from "@/lib/types";
import { Card, SectionTitle } from "./ui/card";

/** Right-hand panel listing the teams registered in a division. */
export function DivisionTeamsPanel({
  division,
  tournamentId,
  showRegister,
}: {
  division: DivisionVM;
  tournamentId: string;
  showRegister?: boolean;
}) {
  const teams = [...division.teams].sort(
    (a, b) => (a.seed ?? 999) - (b.seed ?? 999) || (a.teamName ?? "").localeCompare(b.teamName ?? ""),
  );

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <SectionTitle className="mb-0">Teams · {teams.length}</SectionTitle>
        {showRegister && (
          <Link
            href={`/tournament/register/?id=${tournamentId}`}
            className="flex items-center gap-1 text-xs text-accent hover:opacity-80"
          >
            <UserPlus size={13} /> Register
          </Link>
        )}
      </div>

      {teams.length === 0 ? (
        <p className="mt-3 text-sm text-text-secondary">No teams registered yet.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {teams.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-small px-1 py-1 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                {t.seed != null && (
                  <span className="w-5 shrink-0 text-right text-xs text-text-secondary tabular-nums">
                    {t.seed}
                  </span>
                )}
                <span className="truncate">{t.teamName ?? "Team"}</span>
              </span>
              {t.checked_in && (
                <CheckCircle2 size={15} className="shrink-0 text-success" aria-label="Checked in" />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
