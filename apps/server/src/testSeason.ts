import type { PrismaClient } from "@nrl/db";
import { isTestSeason } from "@nrl/shared";

/**
 * Test seasons (see @nrl/shared testSeason): a copy of a real season's draw
 * with every kickoff moved by the same amount. Games reveal themselves as the
 * real clock passes their (moved) kickoff: team lists a few days before, stats
 * at kickoff, full time two hours after. Nothing here touches real seasons.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Team lists come out about this long before a round's first game. */
const TEAM_LISTS_BEFORE = 2.5 * DAY;
const GAME_LENGTH = 2 * HOUR;

const PREFIX = "test-";
const testMatchId = (id: string) => `${PREFIX}${id}`;
const sourceMatchId = (id: string) => id.slice(PREFIX.length);

/** Copy `realSeason`'s draw as its test season, kickoffs moved by `shiftMs`. Replaces any earlier copy. */
export async function buildTestSeason(db: PrismaClient, realSeason: number, testSeason: number, shiftMs: number, now = new Date()) {
  const rounds = await db.round.findMany({ where: { season: realSeason }, include: { matches: true }, orderBy: { number: "asc" } });
  if (rounds.length === 0) throw new Error(`No ${realSeason} data to copy`);
  await db.round.deleteMany({ where: { season: testSeason } });
  for (const r of rounds) {
    await db.round.create({
      data: {
        season: testSeason, number: r.number, title: r.title, slug: r.slug, isFinals: r.isFinals, byeClubKeys: r.byeClubKeys,
        matches: {
          create: r.matches.map((m) => ({
            id: testMatchId(m.id), homeClubId: m.homeClubId, awayClubId: m.awayClubId, venue: m.venue,
            kickoffAt: new Date(m.kickoffAt.getTime() + shiftMs), url: `test:${m.url}`, state: "Upcoming",
          })),
        },
      },
    });
  }
  await syncTestSeason(db, testSeason, now);
}

/** Move every kickoff of a test season by `shiftMs` (negative: games happen sooner). */
export async function shiftTestSeason(db: PrismaClient, testSeason: number, shiftMs: number, now = new Date()) {
  if (!isTestSeason(testSeason)) throw new Error(`${testSeason} isn't a test season`);
  await db.$executeRaw`
    UPDATE "Match" SET "kickoffAt" = "kickoffAt" + make_interval(secs => ${shiftMs / 1000}::double precision)
    WHERE "roundId" IN (SELECT id FROM "Round" WHERE season = ${testSeason})`;
  await syncTestSeason(db, testSeason, now);
}

/** Reveal what the clock says has happened: team lists, then stats, then full time. */
export async function syncTestSeason(db: PrismaClient, testSeason: number, now = new Date()) {
  // Games moved back into the future (a rewind) are unplayed again.
  const rewound = await db.match.findMany({
    where: { state: { not: "Upcoming" }, kickoffAt: { gt: now }, round: { season: testSeason } },
    select: { id: true },
  });
  for (const m of rewound) {
    await db.match.update({ where: { id: m.id }, data: { state: "Upcoming", homeScore: null, awayScore: null } });
    await db.appearance.deleteMany({ where: { matchId: m.id } });
  }
  const matches = await db.match.findMany({
    where: { state: { not: "FullTime" }, kickoffAt: { lte: new Date(now.getTime() + 7 * DAY) }, round: { season: testSeason } },
    include: { _count: { select: { appearances: true } }, round: { include: { matches: { select: { kickoffAt: true } } } } },
  });
  for (const m of matches) {
    const kickoff = m.kickoffAt.getTime();
    const firstKickoff = Math.min(...m.round.matches.map((x) => x.kickoffAt.getTime()));
    const source = sourceMatchId(m.id);
    if (kickoff <= now.getTime()) {
      const fullTime = now.getTime() >= kickoff + GAME_LENGTH;
      if (m.state === "Upcoming") await copyAppearances(db, source, m.id, true);
      if (fullTime || m.state === "Upcoming") {
        const real = fullTime ? await db.match.findUnique({ where: { id: source }, select: { homeScore: true, awayScore: true } }) : null;
        await db.match.update({
          where: { id: m.id },
          data: fullTime ? { state: "FullTime", homeScore: real?.homeScore ?? null, awayScore: real?.awayScore ?? null } : { state: "SecondHalf" },
        });
      }
    } else if (m._count.appearances === 0 && now.getTime() >= firstKickoff - TEAM_LISTS_BEFORE) {
      await copyAppearances(db, source, m.id, false);
    }
  }
}

async function copyAppearances(db: PrismaClient, from: string, to: string, withStats: boolean) {
  const apps = await db.appearance.findMany({ where: { matchId: from } });
  await db.$transaction([
    db.appearance.deleteMany({ where: { matchId: to } }),
    db.appearance.createMany({
      data: apps.map((a) => ({
        matchId: to, playerId: a.playerId, clubId: a.clubId, jersey: a.jersey, positionLabel: a.positionLabel, isStarter: a.isStarter,
        ...(withStats
          ? {
              minutes: a.minutes, runMetres: a.runMetres, tackles: a.tackles, tries: a.tries, tryAssists: a.tryAssists,
              goals: a.goals, errors: a.errors, stats: a.stats ?? undefined,
            }
          : {}),
      })),
    }),
  ]);
}

/**
 * For the server: before a league in a test season is read, catch its games
 * up with the clock (at most every 30 seconds). Real leagues cost one lookup,
 * once.
 */
export function testSeasonSyncer(db: PrismaClient, now: () => Date = () => new Date()) {
  const seasonOf = new Map<string, number | null>();
  const lastSync = new Map<number, number>();
  return async (leagueId: string) => {
    if (!seasonOf.has(leagueId)) {
      const l = await db.league.findUnique({ where: { id: leagueId }, select: { season: true } });
      seasonOf.set(leagueId, l?.season ?? null);
    }
    const season = seasonOf.get(leagueId);
    if (season == null || !isTestSeason(season)) return;
    const t = now().getTime();
    if (t - (lastSync.get(season) ?? 0) < 30_000) return;
    lastSync.set(season, t);
    await syncTestSeason(db, season, now());
  };
}
