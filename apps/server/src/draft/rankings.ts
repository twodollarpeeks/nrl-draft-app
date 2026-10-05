import type { PrismaClient } from "@nrl/db";
import { playerPoints } from "@nrl/scoring";
import { effectivePositions, type DraftPlayer, type ScoringRules } from "@nrl/shared";

/**
 * The season whose stats rank players for a league's draft: the latest season
 * before the league's with any data, or the league's own season when there is
 * none (e.g. replaying 2026 with only 2026 loaded).
 */
export async function rankingSeason(db: PrismaClient, leagueSeason: number): Promise<number | null> {
  const prev = await db.round.findFirst({
    where: { season: { lt: leagueSeason }, matches: { some: {} } },
    orderBy: { season: "desc" },
    select: { season: true },
  });
  if (prev) return prev.season;
  const same = await db.round.findFirst({ where: { season: leagueSeason }, select: { season: true } });
  return same?.season ?? null;
}

interface Totals {
  player_id: number;
  games: number;
  run_metres: number;
  tackles: number;
  tries: number;
  try_assists: number;
  goals: number;
  errors: number;
}

/**
 * Small samples are shrunk towards zero, so a one-game wonder doesn't outrank
 * a regular: score = average x games / (games + 3).
 */
export function rankScore(avg: number, games: number): number {
  return (avg * games) / (games + 3);
}

/** Every player who played in the ranking season, best first. */
export async function loadDraftPlayers(
  db: PrismaClient,
  leagueSeason: number,
  scoring: ScoringRules,
): Promise<DraftPlayer[]> {
  const season = await rankingSeason(db, leagueSeason);
  if (season === null) return [];

  // One aggregate over the season's appearances (games = took the field).
  const totals = await db.$queryRaw<Totals[]>`
    SELECT a."playerId" AS player_id,
           COUNT(*)::int AS games,
           SUM(a."runMetres")::int AS run_metres,
           SUM(a.tackles)::int AS tackles,
           SUM(a.tries)::int AS tries,
           SUM(a."tryAssists")::int AS try_assists,
           SUM(a.goals)::int AS goals,
           SUM(a.errors)::int AS errors
    FROM "Appearance" a
    JOIN "Match" m ON m.id = a."matchId"
    JOIN "Round" r ON r.id = m."roundId"
    WHERE r.season = ${season} AND a.minutes > 0
    GROUP BY a."playerId"`;

  const players = await db.player.findMany({
    where: { id: { in: totals.map((t) => t.player_id) } },
    select: {
      id: true, firstName: true, lastName: true, positions: true, positionsOverride: true,
      club: { select: { key: true, nickName: true } },
    },
  });
  const byId = new Map(players.map((p) => [p.id, p]));

  const rows = totals.flatMap((t) => {
    const p = byId.get(t.player_id);
    if (!p) return [];
    const total = playerPoints(
      {
        runMetres: t.run_metres, tackles: t.tackles, tries: t.tries,
        tryAssists: t.try_assists, goals: t.goals, errors: t.errors,
      },
      scoring,
    );
    const avgPoints = Math.round((total / t.games) * 10) / 10;
    return [{
      id: p.id,
      name: `${p.firstName} ${p.lastName}`,
      club: p.club,
      positions: effectivePositions(p),
      statsSeason: season,
      games: t.games,
      avgPoints,
      score: rankScore(total / t.games, t.games),
    }];
  });

  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return rows.map(({ score: _score, ...r }, i) => ({ ...r, rank: i + 1 }));
}
