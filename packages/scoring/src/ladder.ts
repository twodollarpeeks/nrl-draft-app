import type { Tiebreaker } from "@nrl/shared";
import { roundPoints } from "./playerPoints.ts";

export interface MatchResult<T> {
  home: T;
  away: T;
  homePoints: number;
  awayPoints: number;
}

export interface LadderRow<T> {
  team: T;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Wins, with draws counting half. */
  winScore: number;
}

/**
 * Head-to-head ladder: ranked on wins (draws = half), then each tiebreaker in
 * turn. "headToHead" compares only the games between the tied teams, so it
 * works for 3+ way ties. Anything still tied keeps the input order of `teams`.
 */
export function headToHeadLadder<T>(
  teams: readonly T[],
  results: readonly MatchResult<T>[],
  tiebreakers: readonly Tiebreaker[],
): LadderRow<T>[] {
  const rows = new Map<T, LadderRow<T>>(
    teams.map((team) => [
      team,
      { team, played: 0, wins: 0, draws: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, winScore: 0 },
    ]),
  );

  for (const r of results) {
    const home = rows.get(r.home);
    const away = rows.get(r.away);
    if (!home || !away) throw new Error("Result for a team not in the ladder");
    for (const [row, pf, pa] of [
      [home, r.homePoints, r.awayPoints],
      [away, r.awayPoints, r.homePoints],
    ] as const) {
      row.played++;
      row.pointsFor = roundPoints(row.pointsFor + pf);
      row.pointsAgainst = roundPoints(row.pointsAgainst + pa);
      if (pf > pa) row.wins++;
      else if (pf < pa) row.losses++;
      else row.draws++;
      row.winScore = row.wins + row.draws / 2;
    }
  }

  const ordered = [...rows.values()];
  return rankGroup(ordered, ["winScore", ...tiebreakers], results);
}

/** Total-points ladder: ranked on points scored, ties keep input order. */
export function totalPointsLadder<T>(
  teams: readonly T[],
  roundTotals: ReadonlyArray<{ team: T; points: number }>,
): Array<{ team: T; pointsFor: number }> {
  const totals = new Map<T, number>(teams.map((t) => [t, 0]));
  for (const { team, points } of roundTotals) {
    totals.set(team, roundPoints((totals.get(team) ?? 0) + points));
  }
  return stableSortDesc(
    teams.map((team) => ({ team, pointsFor: totals.get(team)! })),
    (r) => r.pointsFor,
  );
}

type Criterion = "winScore" | Tiebreaker;

function rankGroup<T>(
  group: LadderRow<T>[],
  criteria: readonly Criterion[],
  results: readonly MatchResult<T>[],
): LadderRow<T>[] {
  if (group.length <= 1 || criteria.length === 0) return group;
  const [criterion, ...rest] = criteria as [Criterion, ...Criterion[]];
  const metric = metricFor(criterion, group, results);

  // Partition into runs of equal metric (higher is better), then break ties
  // within each run using the remaining criteria.
  const sorted = stableSortDesc(group, metric);
  const out: LadderRow<T>[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && metric(sorted[j]!) === metric(sorted[i]!)) j++;
    out.push(...rankGroup(sorted.slice(i, j), rest, results));
    i = j;
  }
  return out;
}

function metricFor<T>(
  criterion: Criterion,
  group: readonly LadderRow<T>[],
  results: readonly MatchResult<T>[],
): (row: LadderRow<T>) => number {
  switch (criterion) {
    case "winScore":
      return (r) => r.winScore;
    case "pointsFor":
      return (r) => r.pointsFor;
    case "pointsAgainst":
      return (r) => -r.pointsAgainst; // fewer conceded ranks higher
    case "headToHead": {
      const tied = new Set(group.map((r) => r.team));
      const h2h = new Map<T, number>();
      for (const m of results) {
        if (!tied.has(m.home) || !tied.has(m.away)) continue;
        const [h, a] =
          m.homePoints > m.awayPoints ? [1, 0] : m.homePoints < m.awayPoints ? [0, 1] : [0.5, 0.5];
        h2h.set(m.home, (h2h.get(m.home) ?? 0) + h);
        h2h.set(m.away, (h2h.get(m.away) ?? 0) + a);
      }
      return (r) => h2h.get(r.team) ?? 0;
    }
  }
}

function stableSortDesc<R>(rows: readonly R[], key: (r: R) => number): R[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => key(b.r) - key(a.r) || a.i - b.i)
    .map(({ r }) => r);
}
