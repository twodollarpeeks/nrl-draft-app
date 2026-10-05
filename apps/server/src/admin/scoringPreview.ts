import type { PrismaClient } from "@nrl/db";
import type { NrlPosition, ScoringPreview, ScoringPreviewGroup, ScoringRules } from "@nrl/shared";
import { latestSeason, rankPlayers } from "../draft/rankings.ts";

const GROUPS: Array<{ group: ScoringPreviewGroup["group"]; label: string; starters: number; positions: NrlPosition[] }> = [
  { group: "FWD", label: "Forwards", starters: 24, positions: ["FRF", "2RF", "LK"] },
  { group: "OB", label: "Outside backs", starters: 24, positions: ["FB", "WG", "CE"] },
  { group: "HBHK", label: "Halves & hookers", starters: 8, positions: ["HB", "FE", "HK"] },
];
// Ignore part-timers: their averages are noise.
const MIN_GAMES = 10;

/**
 * How even a scoring is across positions, using the latest season. For each
 * group: the average of the last starter an 8-team league would field (24th
 * forward, 24th outside back, 8th half/hooker), and the best player. If those
 * starter levels are close, no position is an automatic early pick.
 */
export async function scoringPreview(db: PrismaClient, scoring: ScoringRules): Promise<ScoringPreview | null> {
  const season = await latestSeason(db);
  if (season === null) return null;
  const ranked = await rankPlayers(db, season, scoring);
  const regulars = ranked.filter((p) => p.games >= MIN_GAMES);

  const groups = GROUPS.map((g) => {
    // Grouped by primary (first-listed) position.
    const avgs = regulars
      .filter((p) => p.positions[0] && g.positions.includes(p.positions[0]))
      .sort((a, b) => b.avgPoints - a.avgPoints);
    const last = avgs[Math.min(g.starters, avgs.length) - 1];
    return {
      group: g.group,
      label: g.label,
      starters: g.starters,
      starterLevel: last?.avgPoints ?? 0,
      best: avgs[0] ? { name: avgs[0].name, avgPoints: avgs[0].avgPoints } : null,
    };
  });

  const levels = groups.map((g) => g.starterLevel);
  const min = Math.min(...levels);
  const spread = min > 0 ? Math.round((Math.max(...levels) / min) * 100) / 100 : Infinity;

  return {
    season,
    spread,
    groups,
    top: ranked.slice(0, 20).map((p) => ({
      rank: p.rank, name: p.name, club: p.club?.nickName ?? null, positions: p.positions, avgPoints: p.avgPoints, games: p.games,
    })),
  };
}
