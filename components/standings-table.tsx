import type { StandingRow } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Group standings — tie-break already applied (wins, then point_diff). */
export function StandingsTable({
  rows,
  groupNames,
  className,
}: {
  rows: StandingRow[];
  /** group_id → name. Adds a Group column — for tables pooled across groups. */
  groupNames?: Map<string, string>;
  className?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-text-secondary">No standings yet.</p>;
  }
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-text-secondary">
            <th className="py-2 pr-2 font-medium">#</th>
            <th className="py-2 pr-2 font-medium">Team</th>
            {groupNames && <th className="py-2 pr-2 font-medium">Group</th>}
            <th className="py-2 px-2 text-center font-medium">P</th>
            <th className="py-2 px-2 text-center font-medium">W</th>
            <th className="py-2 px-2 text-center font-medium">L</th>
            <th className="py-2 pl-2 text-center font-medium">+/−</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.tournament_team_id ?? i} className="border-t border-divider">
              <td className="py-2 pr-2 text-text-secondary tabular-nums">{i + 1}</td>
              <td className="py-2 pr-2 font-medium">{r.team_name ?? "—"}</td>
              {groupNames && (
                <td className="py-2 pr-2 text-text-secondary">
                  {(r.group_id && groupNames.get(r.group_id)) ?? "—"}
                </td>
              )}
              <td className="py-2 px-2 text-center tabular-nums">{r.matches_played ?? 0}</td>
              <td className="py-2 px-2 text-center tabular-nums">{r.wins ?? 0}</td>
              <td className="py-2 px-2 text-center tabular-nums">{r.losses ?? 0}</td>
              <td
                className={cn(
                  "py-2 pl-2 text-center tabular-nums",
                  (r.point_diff ?? 0) > 0 && "text-success",
                  (r.point_diff ?? 0) < 0 && "text-text-secondary",
                )}
              >
                {(r.point_diff ?? 0) > 0 ? "+" : ""}
                {r.point_diff ?? 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
