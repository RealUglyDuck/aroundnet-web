import { CheckCircle2 } from "lucide-react";
import type { DivisionVM } from "@/lib/types";
import { Card, SectionTitle } from "./ui/card";

/**
 * The teams registered in a division — the main content of the tournament page.
 * The competition itself (groups, brackets, standings, scores) lives on
 * Tournament Day, so nothing here duplicates it.
 *
 * Purely a roster read-out: registering is the page header's job, so there is
 * no call to action in here competing with it.
 */
export function DivisionTeamsPanel({
  division,
  title,
}: {
  division: DivisionVM;
  /** Defaults to "Teams". Pass the division name when nothing else names it. */
  title?: string;
}) {
  const teams = [...division.teams].sort(
    (a, b) => (a.seed ?? 999) - (b.seed ?? 999) || (a.teamName ?? "").localeCompare(b.teamName ?? ""),
  );

  return (
    <Card className="p-4">
      <SectionTitle className="mb-0">
        {title ?? "Teams"} · {teams.length}
      </SectionTitle>

      {teams.length === 0 ? (
        <p className="mt-3 text-sm text-text-secondary">No teams registered yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-divider">
          {teams.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-baseline gap-3">
                {t.seed != null && (
                  <span className="w-5 shrink-0 text-right text-xs text-text-secondary tabular-nums">
                    {t.seed}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.teamName ?? "Team"}</p>
                  {t.playerNames.length > 0 && (
                    <p className="truncate text-xs text-text-secondary">
                      {t.playerNames.join(" · ")}
                    </p>
                  )}
                </div>
              </div>
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
