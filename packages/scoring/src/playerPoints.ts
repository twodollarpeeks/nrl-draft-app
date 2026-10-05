import { SCORING_STATS, type ScoringRules, type ScoringStat } from "@nrl/shared";

/** A player's stats for a match (or a season), keyed by catalogue stat. Missing = 0. */
export type StatLine = Partial<Record<ScoringStat, number>>;

/** Round to 2 decimal places, avoiding float noise like 21.300000000000001. */
export function roundPoints(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Fantasy points for one player's match, under a league's scoring rules. */
export function playerPoints(stats: StatLine, rules: ScoringRules): number {
  let total = 0;
  for (const stat of SCORING_STATS) {
    const value = rules[stat];
    if (value) total += (stats[stat] ?? 0) * value;
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
