import { Prisma, type PrismaClient } from "@nrl/db";
import { playerPoints } from "@nrl/scoring";
import {
  RAW_STAT_FIELDS,
  effectivePositions,
  statLineFromRaw,
  type DraftPlayer,
  type ScoringRules,
} from "@nrl/shared";

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

/** The most recent season with any match data. */
export async function latestSeason(db: PrismaClient): Promise<number | null> {
  const r = await db.round.findFirst({ where: { matches: { some: {} } }, orderBy: { season: "desc" }, select: { season: true } });
  return r?.season ?? null;
}

export interface SeasonTotals {
  playerId: number;
  games: number;
  /** Every raw nrl.com stat field, summed over the games played. */
  raw: Record<string, number>;
}

// Field names come from the stat catalogue (a fixed list in our code), but
// they're spliced into SQL, so check they're plain identifiers anyway.
const SAFE_FIELDS = RAW_STAT_FIELDS.filter((f) => /^[A-Za-z0-9]+$/.test(f));

/**
 * Regular-season totals per player for a season, over games where they took
 * the field: one aggregate query over the stored match stats.
 */
export async function seasonTotals(db: PrismaClient, season: number): Promise<SeasonTotals[]> {
  const sums = Prisma.join(
    SAFE_FIELDS.map((f) => Prisma.raw(`SUM(COALESCE((a.stats->>'${f}')::numeric, 0))::float8 AS "${f}"`)),
  );
  const rows = await db.$queryRaw<Array<Record<string, number> & { player_id: number; games: number }>>`
    SELECT a."playerId" AS player_id, COUNT(*)::int AS games, ${sums}
    FROM "Appearance" a
    JOIN "Match" m ON m.id = a."matchId"
    JOIN "Round" r ON r.id = m."roundId"
    WHERE r.season = ${season} AND r."isFinals" = false AND a.minutes > 0
    GROUP BY a."playerId"`;
  return rows.map(({ player_id, games, ...raw }) => ({ playerId: player_id, games, raw }));
}

/**
 * Small samples are shrunk towards zero, so a one-game wonder doesn't outrank
 * a regular: score = average x games / (games + 3).
 */
export function rankScore(avg: number, games: number): number {
  return (avg * games) / (games + 3);
}

/** Rank players from season stats under a scoring. Best first. */
export async function rankPlayers(
  db: PrismaClient,
  season: number,
  scoring: ScoringRules,
): Promise<DraftPlayer[]> {
  const totals = await seasonTotals(db, season);
  const players = await db.player.findMany({
    where: { id: { in: totals.map((t) => t.playerId) } },
    select: {
      id: true, firstName: true, lastName: true, positions: true, positionsOverride: true,
      club: { select: { key: true, nickName: true } },
    },
  });
  const byId = new Map(players.map((p) => [p.id, p]));

  const rows = totals.flatMap((t) => {
    const p = byId.get(t.playerId);
    if (!p) return [];
    const total = playerPoints(statLineFromRaw(t.raw), scoring);
    return [{
      id: p.id,
      name: `${p.firstName} ${p.lastName}`,
      club: p.club,
      positions: effectivePositions(p),
      statsSeason: season,
      games: t.games,
      avgPoints: Math.round((total / t.games) * 10) / 10,
      score: rankScore(total / t.games, t.games),
    }];
  });

  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return rows.map(({ score: _score, ...r }, i) => ({ ...r, rank: i + 1 }));
}

/** Every player who played in the ranking season for a league, best first. */
export async function loadDraftPlayers(
  db: PrismaClient,
  leagueSeason: number,
  scoring: ScoringRules,
): Promise<DraftPlayer[]> {
  const season = await rankingSeason(db, leagueSeason);
  return season === null ? [] : rankPlayers(db, season, scoring);
}
