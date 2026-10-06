import type { Prisma } from "@nrl/db";
import { roundRobin } from "@nrl/scoring";
import { LeagueSettings, NRL_LAST_ROUND, seasonRounds } from "@nrl/shared";

type Tx = Prisma.TransactionClient;

/**
 * The league's first fantasy round: the first NRL round that hasn't started
 * yet. If every round of the season has started (a replay of a finished
 * season) or there's no draw yet, round 1.
 */
export async function firstFantasyRound(tx: Tx, season: number, now: Date): Promise<number> {
  const rounds = await tx.round.findMany({
    where: { season, number: { lte: NRL_LAST_ROUND } },
    orderBy: { number: "asc" },
    select: { number: true, matches: { select: { kickoffAt: true } } },
  });
  if (rounds.length === 0) return 1;
  const notStarted = rounds.find((r) => r.matches.length > 0 && r.matches.every((m) => m.kickoffAt > now));
  if (notStarted) return notStarted.number;
  const allStarted = rounds.every((r) => r.matches.every((m) => m.kickoffAt <= now));
  if (allStarted && rounds.length >= NRL_LAST_ROUND) return 1; // the whole season is over: replay it
  // Part-way through and later rounds' draws aren't loaded yet: the next round.
  return rounds.at(-1)!.number + 1;
}

/** When the draft finishes: fix the first round and, for head-to-head, the fixture. */
export async function startSeason(tx: Tx, leagueId: string, teamOrder: readonly string[], now: Date) {
  const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = LeagueSettings.parse(league.settings);
  const firstRound = await firstFantasyRound(tx, league.season, now);
  await tx.league.update({ where: { id: leagueId }, data: { firstRound } });

  await tx.matchup.deleteMany({ where: { leagueId } });
  if (settings.matchups.mode !== "headToHead") return;
  const { lastRegularRound } = seasonRounds(settings.seasonEndRound, settings.matchups);
  const rounds = lastRegularRound - firstRound + 1;
  if (rounds <= 0) return;
  const schedule = roundRobin(teamOrder, rounds);
  await tx.matchup.createMany({
    data: schedule.flatMap((pairs, i) =>
      pairs.map((p) => ({ leagueId, round: firstRound + i, homeTeamId: p.home, awayTeamId: p.away })),
    ),
  });
}

/** Undoing the last pick of a finished draft puts the league back before the season. */
export async function unstartSeason(tx: Tx, leagueId: string) {
  await tx.matchup.deleteMany({ where: { leagueId } });
  await tx.lineup.deleteMany({ where: { leagueId } });
  await tx.league.update({ where: { id: leagueId }, data: { firstRound: null } });
}
