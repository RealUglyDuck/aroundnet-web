import type { BracketMatchVM, DivisionVM, GroupVM, StageVM, StandingRow } from "./types";
import { sortStandings } from "./types";

export interface SlotSeeds {
  a: number | null;
  b: number | null;
}

/**
 * Seed number carried by each bracket slot.
 *
 * A bracket's first round is seeded off the combined group table — the same
 * ranking `generate-bracket` used (all groups pooled, wins then point
 * difference), so slot 1 is the overall top qualifier. From there the number
 * follows the line rather than the team: the winner's slot inherits the lower
 * of the two numbers and the loser drops into the consolation bracket carrying
 * the higher one. In a bracket that places every team this converges on the
 * finishing positions — a 16-team main bracket ends with the final on slots
 * (1, 2) and the 3rd-place match on (4, 3).
 *
 * Where the generator trims a consolation bracket to a power of two, some
 * losers have no onward match; their line simply stops, and the numbers in
 * those brackets stay seeding lines rather than final places.
 */
export function bracketSeeds(
  division: DivisionVM,
  stage: StageVM,
): Map<string, SlotSeeds> {
  const seedsByMatch = new Map<string, SlotSeeds>();
  if (stage.brackets.length === 0) return seedsByMatch;

  const matchById = new Map<string, BracketMatchVM>();
  for (const bracket of stage.brackets) {
    for (const match of bracket.matches) matchById.set(match.id, match);
  }

  const ranks = overallRanks(feederStage(division, stage, qualifiers(stage)));

  // Guards a malformed graph (a source cycle) from recursing forever.
  const resolving = new Set<string>();

  function seedsFor(match: BracketMatchVM): SlotSeeds {
    const cached = seedsByMatch.get(match.id);
    if (cached) return cached;
    if (resolving.has(match.id)) return { a: null, b: null };

    resolving.add(match.id);
    const seeds: SlotSeeds = { a: slotSeed(match, "a"), b: slotSeed(match, "b") };
    resolving.delete(match.id);

    seedsByMatch.set(match.id, seeds);
    return seeds;
  }

  function slotSeed(match: BracketMatchVM, side: "a" | "b"): number | null {
    const sourceType = side === "a" ? match.teamASourceType : match.teamBSourceType;
    const sourceMatchId =
      side === "a" ? match.teamASourceMatchId : match.teamBSourceMatchId;

    // No upstream match — seeded straight from the group table.
    if (!sourceType || !sourceMatchId) {
      const teamId = side === "a" ? match.team_a_id : match.team_b_id;
      return (teamId ? ranks.get(teamId) : null) ?? null;
    }

    const source = matchById.get(sourceMatchId);
    if (!source) return null;
    const { a, b } = seedsFor(source);

    if (sourceType === "winner_of") {
      // A bye leaves one side empty; whoever is there advances.
      if (a == null) return b;
      if (b == null) return a;
      return Math.min(a, b);
    }
    if (sourceType === "loser_of") {
      // A bye has no loser to drop.
      if (a == null || b == null) return null;
      return Math.max(a, b);
    }
    return null;
  }

  for (const bracket of stage.brackets) {
    for (const match of bracket.matches) seedsFor(match);
  }
  return seedsByMatch;
}

/** Teams the bracket actually started with — its first-round occupants. */
function qualifiers(stage: StageVM): Set<string> {
  const ids = new Set<string>();
  for (const bracket of stage.brackets) {
    for (const match of bracket.matches) {
      if (match.round !== 1) continue;
      if (match.team_a_id) ids.add(match.team_a_id);
      if (match.team_b_id) ids.add(match.team_b_id);
    }
  }
  return ids;
}

/**
 * Which group stage fed this bracket. `generate-bracket` takes source_stage_ids
 * but doesn't persist them, and a division can hold several group stages with
 * the same sort_order — pooling them all would rank a team twice and blow the
 * numbering past the field size. So pick the single stage that best explains
 * the bracket: the one whose standings cover the most of its qualifiers,
 * preferring stages that ran before it, then the most recently created.
 */
function feederStage(
  division: DivisionVM,
  stage: StageVM,
  qualifierIds: Set<string>,
): StageVM | null {
  const candidates = division.stages.filter((s) => s.type === "group_stage");
  if (candidates.length === 0) return null;

  const score = (s: StageVM) => {
    let covered = 0;
    for (const g of s.groups) {
      for (const row of g.standings) {
        if (row.tournament_team_id && qualifierIds.has(row.tournament_team_id)) covered++;
      }
    }
    return covered;
  };

  return [...candidates].sort((a, b) => {
    const aEarlier = a.sort_order < stage.sort_order ? 1 : 0;
    const bEarlier = b.sort_order < stage.sort_order ? 1 : 0;
    if (aEarlier !== bEarlier) return bEarlier - aEarlier;
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return b.created_at.localeCompare(a.created_at);
  })[0];
}

/**
 * Every group's standings pooled and ranked as one table — wins, then point
 * difference. This is the order `generate-bracket` seeds from, so row 1 is the
 * bracket's 1 line. Shown in the UI as the seeding table.
 */
export function seedingTable(groups: GroupVM[]): StandingRow[] {
  return sortStandings(groups.flatMap((g) => g.standings));
}

/** tournament_team_id → rank across every group of the feeding stage pooled. */
function overallRanks(groupStage: StageVM | null): Map<string, number> {
  const ranks = new Map<string, number>();
  if (!groupStage) return ranks;
  seedingTable(groupStage.groups).forEach((row, i) => {
    if (row.tournament_team_id) ranks.set(row.tournament_team_id, i + 1);
  });
  return ranks;
}
