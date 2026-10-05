import { SCORING_STATS, type ScoringRules, type ScoringStat } from "@nrl/shared";

export type StatLine = Record<ScoringStat, number>;

/** Round to 2 decimal places, avoiding float noise like 21.300000000000001. */
export function roundPoints(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Fantasy points for one player's match, under a league's scoring rules. */
export function playerPoints(stats: StatLine, rules: ScoringRules): number {
  let total = 0;
  for (const stat of SCORING_STATS) {
    total += (stats[stat] ?? 0) * (rules[stat] ?? 0);
  }
  return roundPoints(total);
}

/** Points per stat, for showing a breakdown. Stats worth 0 are left out. */
export function pointsBreakdown(
  stats: StatLine,
  rules: ScoringRules,
): Array<{ stat: ScoringStat; value: number; points: number }> {
  return SCORING_STATS.flatMap((stat) => {
    const value = stats[stat] ?? 0;
    const points = roundPoints(value * (rules[stat] ?? 0));
    return points === 0 ? [] : [{ stat, value, points }];
  });
}
