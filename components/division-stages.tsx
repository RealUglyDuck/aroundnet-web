"use client";

import * as React from "react";
import { LayoutGrid, ListTree } from "lucide-react";
import type { DivisionVM, StageVM, GroupVM, GroupMatchVM, MatchVM } from "@/lib/types";
import { stageSettingsSummary } from "@/lib/types";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { StandingsTable } from "./standings-table";
import { BracketView } from "./bracket-view";
import { MatchCard } from "./match-card";

/** Matches split into rounds, ordered by round then position. */
function matchesByRound(matches: GroupMatchVM[]): { round: number | null; matches: GroupMatchVM[] }[] {
  const rounds = new Map<number | null, GroupMatchVM[]>();
  for (const m of matches) {
    const key = m.round ?? null;
    const bucket = rounds.get(key);
    if (bucket) bucket.push(m);
    else rounds.set(key, [m]);
  }
  return [...rounds.entries()]
    .sort((a, b) => (a[0] ?? Infinity) - (b[0] ?? Infinity))
    .map(([round, ms]) => ({
      round,
      matches: [...ms].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    }));
}

function GroupPanel({
  group,
  bestOf,
  canEditMatch,
  onSubmitted,
}: {
  group: GroupVM;
  bestOf: number;
  canEditMatch?: (match: MatchVM) => boolean;
  onSubmitted: () => void;
}) {
  const played = group.matches.filter((m) => m.status === "completed" || m.is_bye).length;
  const rounds = matchesByRound(group.matches);

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="font-semibold">{group.name}</h4>
        {group.isComplete && <Badge tone="success">Complete</Badge>}
        <span className="text-xs text-text-secondary">
          {group.teams.length} teams · {played}/{group.matches.length} matches played
        </span>
      </div>

      <StandingsTable rows={group.standings} />

      {group.matches.length > 0 && (
        <div className="mt-5 space-y-4">
          <h5 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Matches
          </h5>
          {rounds.map(({ round, matches }) => (
            <div key={round ?? "unassigned"} className="space-y-2">
              {rounds.length > 1 && (
                <p className="text-xs text-text-secondary">
                  {round == null ? "Unscheduled" : `Round ${round}`}
                </p>
              )}
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {matches.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    bestOf={bestOf}
                    canEdit={canEditMatch?.(m) ?? false}
                    onSubmitted={onSubmitted}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Group picker (Group A / B / C …) showing one group's full standings + all its matches. */
function GroupStagePanel({
  groups,
  bestOf,
  canEditMatch,
  onSubmitted,
}: {
  groups: GroupVM[];
  bestOf: number;
  canEditMatch?: (match: MatchVM) => boolean;
  onSubmitted: () => void;
}) {
  const [selectedId, setSelectedId] = React.useState(groups[0].id);
  // Groups can change under us on realtime reload — fall back to the first one.
  const activeId = groups.some((g) => g.id === selectedId) ? selectedId : groups[0].id;

  if (groups.length === 1) {
    return (
      <GroupPanel
        group={groups[0]}
        bestOf={bestOf}
        canEditMatch={canEditMatch}
        onSubmitted={onSubmitted}
      />
    );
  }

  return (
    <Tabs value={activeId} onValueChange={setSelectedId}>
      <TabsList className="mb-3 flex-wrap">
        {groups.map((g) => (
          <TabsTrigger key={g.id} value={g.id}>
            {g.name}
            {g.isComplete && <span className="ml-1.5 text-xs">✓</span>}
          </TabsTrigger>
        ))}
      </TabsList>
      {groups.map((g) => (
        <TabsContent key={g.id} value={g.id}>
          <GroupPanel
            group={g}
            bestOf={bestOf}
            canEditMatch={canEditMatch}
            onSubmitted={onSubmitted}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function StageBlock({
  stage,
  canEditMatch,
  onSubmitted,
}: {
  stage: StageVM;
  canEditMatch?: (match: MatchVM) => boolean;
  onSubmitted: () => void;
}) {
  const isGroup = stage.type === "group_stage";
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {isGroup ? (
          <LayoutGrid size={16} className="text-text-secondary" />
        ) : (
          <ListTree size={16} className="text-text-secondary" />
        )}
        <h3 className="font-semibold">{stage.name}</h3>
        <Badge tone={isGroup ? "neutral" : "accent"}>
          {isGroup ? "Group stage" : "Bracket"}
        </Badge>
        <span className="text-xs text-text-secondary">{stageSettingsSummary(stage)}</span>
      </div>

      {isGroup ? (
        stage.groups.length === 0 ? (
          <p className="text-sm text-text-secondary">No groups yet.</p>
        ) : (
          <GroupStagePanel
            groups={stage.groups}
            bestOf={stage.best_of}
            canEditMatch={canEditMatch}
            onSubmitted={onSubmitted}
          />
        )
      ) : stage.brackets.length === 0 ? (
        <p className="text-sm text-text-secondary">No brackets yet.</p>
      ) : (
        <div className="space-y-5">
          {stage.brackets.map((b) => (
            <Card key={b.id} className="p-4">
              <h4 className="mb-3 font-semibold">{b.name}</h4>
              <BracketView
                bracket={b}
                bestOf={stage.best_of}
                canEditMatch={canEditMatch}
                onSubmitted={onSubmitted}
              />
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

export function DivisionStages({
  division,
  canEditMatch,
  onSubmitted,
}: {
  division: DivisionVM;
  canEditMatch?: (match: MatchVM) => boolean;
  onSubmitted: () => void;
}) {
  if (division.stages.length === 0) {
    return (
      <p className="rounded-card bg-surface-high p-6 text-center text-sm text-text-secondary">
        No stages yet in {division.name}.
      </p>
    );
  }
  return (
    <div className="space-y-8">
      {division.stages.map((s) => (
        <StageBlock key={s.id} stage={s} canEditMatch={canEditMatch} onSubmitted={onSubmitted} />
      ))}
    </div>
  );
}
