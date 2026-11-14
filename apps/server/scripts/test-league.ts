// A test league: the sample league replayed mid-season on today's calendar,
// for trying lineups, free agency, waivers and trades. The 2026 season is
// copied as a test season (shown as "2026 (test)") with every game moved by
// whole weeks, so rounds keep their real days and Wednesday waivers line up.
// Games then play out with the real clock: team lists a few days before,
// scores from kickoff, final a day after.
//
//   npm run test-league -- setup                 Rebuild it with round 13 this week
//   npm run test-league -- setup --round 20      ...or another round
//   npm run test-league -- round 13              Move the calendar so round 13 is next up,
//                                                 not started (keeps squads, lineups, trades)
//   npm run test-league -- advance               Jump a week: this round's games are played
//   npm run test-league -- advance --weeks 3
//   npm run test-league -- cpu                   Demo managers accept your offers and vote on trades
//   npm run test-league -- cpu --reject          ...reject your offers instead
//   npm run test-league -- cpu --offer           ...and one of them offers you a trade
//   npm run test-league -- status                Where the test season is up to
//
// `setup` replaces the sample league (`npm run seed` brings back the finished
// 2026 one). You keep the commissioner's seat; the others are demo managers.

import { parseArgs } from "node:util";
import { createPrisma } from "@nrl/db";
import { isTestSeason, realSeasonOf, testSeasonOf, waiverClearings } from "@nrl/shared";
import type { SessionUser } from "../src/auth.ts";
import { RosterService } from "../src/roster/service.ts";
import { SeasonService } from "../src/season/service.ts";
import { buildTestSeason, shiftTestSeason, syncTestSeason } from "../src/testSeason.ts";
import { TradeService } from "../src/trades/service.ts";
import { SEED_ACTION, createSampleLeague, deleteSampleLeagues } from "./sampleLeague.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    round: { type: "string", default: "13" },
    season: { type: "string", default: "2026" },
    owner: { type: "string" },
    teams: { type: "string" },
    weeks: { type: "string", default: "1" },
    reject: { type: "boolean", default: false },
    offer: { type: "boolean", default: false },
  },
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const db = createPrisma();
const command = positionals[0] ?? "status";
const fmt = (d: Date) =>
  d.toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** The sample league, if there is one. */
async function sampleLeague() {
  const seeded = await db.auditLog.findFirst({ where: { action: SEED_ACTION }, orderBy: { createdAt: "desc" }, select: { leagueId: true } });
  if (!seeded?.leagueId) return null;
  return db.league.findUnique({ where: { id: seeded.leagueId }, include: { teams: { include: { owner: true } }, commissioner: true } });
}

async function testLeague() {
  const league = await sampleLeague();
  if (!league || !isTestSeason(league.season)) throw new Error("No test league yet. Run: npm run test-league -- setup");
  return league;
}

async function setup() {
  const realSeason = Number(values.season);
  const roundNo = Number(values.round);
  const testSeason = testSeasonOf(realSeason);
  const round = await db.round.findUnique({ where: { season_number: { season: realSeason, number: roundNo } }, include: { matches: true } });
  if (!round || round.matches.length === 0) throw new Error(`No ${realSeason} round ${roundNo} draw. Import it first.`);
  const first = await db.round.findFirst({
    where: { season: realSeason, matches: { some: {} } },
    orderBy: { number: "asc" },
    include: { matches: true },
  });

  // Keep whoever has the sample league now (or --owner) as its commissioner.
  const existing = await sampleLeague();
  const owner = values.owner
    ? await db.user.findUnique({ where: { email: values.owner.toLowerCase() } })
    : existing && !existing.commissioner.email.endsWith("@seed.invalid")
      ? existing.commissioner
      : null;
  if (!owner) throw new Error("Who's it for? Add --owner you@gmail.com (an account that has signed in once).");
  const teamCount = Number(values.teams ?? existing?.teams.length ?? 8);

  // Whole weeks later, so the round's last game is still to come.
  const now = new Date();
  const lastKickoff = Math.max(...round.matches.map((m) => m.kickoffAt.getTime()));
  const weeks = Math.ceil((now.getTime() - lastKickoff) / WEEK + 1e-9);
  // Keeping Sydney kickoff times through daylight saving.
  const shift = weeks * WEEK - (sydneyOffset(lastKickoff + weeks * WEEK) - sydneyOffset(lastKickoff));
  console.log(`Copying ${realSeason} as a test season, ${weeks} weeks later...`);
  await buildTestSeason(db, realSeason, testSeason, shift, now);

  const firstKickoff = Math.min(...first!.matches.map((m) => m.kickoffAt.getTime())) + shift;
  await deleteSampleLeagues(db);
  console.log("Drafting the sample league...");
  const { league } = await createSampleLeague(db, {
    owner,
    teamCount,
    season: testSeason,
    name: "Sample League",
    rankSeason: realSeason,
    seasonStartsAt: new Date(firstKickoff - 24 * HOUR),
  });
  console.log(`Ready: /l/${league.id}`);
  await status();
}

/**
 * Move the calendar (forwards or back) so round `n` is next: every earlier
 * round over, none of its games started. Whole weeks if that works, so days
 * of the week stay real; otherwise whole days, enough that the round before is final.
 */
async function goToRound() {
  const league = await testLeague();
  const n = Number(positionals[1]);
  const rounds = await db.round.findMany({ where: { season: league.season }, include: { matches: { select: { kickoffAt: true } } } });
  const kicks = (no: number) => rounds.find((r) => r.number === no)?.matches.map((m) => m.kickoffAt.getTime()) ?? [];
  if (!Number.isInteger(n) || kicks(n).length === 0) throw new Error("Which round? e.g. npm run test-league -- round 13");
  const now = Date.now();
  const start = Math.min(...kicks(n));
  const prevEnd = n > 1 && kicks(n - 1).length ? Math.max(...kicks(n - 1)) : -Infinity;
  const FINAL = 27 * HOUR; // full time plus the day's stats review, and a little spare
  // How far the test season sits from the real one, to keep moves to whole days.
  const sample = await db.match.findFirstOrThrow({ where: { round: { season: league.season } }, select: { id: true, kickoffAt: true } });
  const real = await db.match.findUniqueOrThrow({ where: { id: sample.id.replace(/^test-/, "") }, select: { kickoffAt: true } });
  const offset = sample.kickoffAt.getTime() - real.kickoffAt.getTime();
  const fits = (s: number) => prevEnd + s + FINAL <= now && start + s > now;
  // A move of whole days from the real dates, keeping Sydney kickoff times through daylight saving.
  const fromReal = (days: number) => {
    const startReal = start - offset;
    return days * DAY - (sydneyOffset(startReal + days * DAY) - sydneyOffset(startReal)) - offset;
  };
  let shift = fromReal(7 * (Math.floor((now - (start - offset)) / WEEK) + 1));
  // Otherwise whole days.
  if (!fits(shift)) shift = fromReal(Math.floor((now - FINAL - (prevEnd - offset)) / DAY));
  if (!fits(shift)) throw new Error(`Round ${n} starts too soon after round ${n - 1} to fit both.`);
  await shiftTestSeason(db, league.season, shift);
  console.log(`Round ${n} is next: first game ${fmt(new Date(start + shift))}.`);
  await status();
}

/** Sydney's offset from UTC at a moment, in ms. */
function sydneyOffset(at: number): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Australia/Sydney", timeZoneName: "longOffset" })
    .formatToParts(new Date(at))
    .find((p) => p.type === "timeZoneName")!.value; // "GMT+11:00"
  const m = /([+-])(\d+):(\d+)/.exec(name)!;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * HOUR + Number(m[3]) * 60_000);
}

async function advance() {
  const league = await testLeague();
  const weeks = Number(values.weeks);
  if (!Number.isInteger(weeks) || weeks < 1) throw new Error("--weeks must be 1 or more");
  await shiftTestSeason(db, league.season, -weeks * WEEK);
  console.log(`Moved ${weeks} week${weeks > 1 ? "s" : ""} on.`);
  await status();
}

async function status() {
  const league = await testLeague();
  await syncTestSeason(db, league.season);
  const now = new Date();
  const rounds = await db.round.findMany({
    where: { season: league.season },
    orderBy: { number: "asc" },
    include: { matches: { select: { kickoffAt: true, state: true } } },
  });
  const current = rounds.find((r) => r.matches.some((m) => m.state !== "FullTime"));
  console.log(`Sample League: ${realSeasonOf(league.season)} (test), ${league.teams.length} teams, commissioner ${league.commissioner.name}`);
  if (!current) return console.log("Every game has been played.");
  const kicks = current.matches.map((m) => m.kickoffAt.getTime()).sort((a, b) => a - b);
  const started = current.matches.filter((m) => m.kickoffAt <= now).length;
  console.log(`Now: ${current.title}, ${started} of ${current.matches.length} games started (${fmt(new Date(kicks[0]!))} to ${fmt(new Date(kicks.at(-1)!))}).`);
  console.log(`Waivers next clear ${fmt(waiverClearings(now).next)}.`);
}

/** Demo managers: answer offers made to them, vote on trades under review, maybe make an offer. */
async function cpu() {
  const league = await testLeague();
  const season = new SeasonService(db);
  const roster = new RosterService(db, season);
  const trades = new TradeService(db, season, roster);
  const asUser = (u: { id: string; name: string; email: string }) => ({ ...u, isAdmin: false }) as unknown as SessionUser;
  const demo = new Map(league.teams.filter((t) => t.owner.email.endsWith("@seed.invalid")).map((t) => [t.id, t]));
  const mine = league.teams.find((t) => t.ownerId === league.commissionerId)!;
  let did = false;

  for (const t of await db.trade.findMany({ where: { leagueId: league.id, status: "proposed" } })) {
    const team = demo.get(t.receiverTeamId);
    if (!team) continue;
    const action = values.reject ? "reject" : "accept";
    did = true;
    try {
      await trades.respond(asUser(team.owner), league.id, t.id, action);
      console.log(`${team.name}: ${action}ed your offer.`);
    } catch (err) {
      console.log(`${team.name} couldn't ${action} your offer: ${(err as Error).message}`);
    }
  }

  for (const t of await db.trade.findMany({ where: { leagueId: league.id, status: "review" }, include: { votes: true } })) {
    for (const team of demo.values()) {
      if ([t.proposerTeamId, t.receiverTeamId].includes(team.id) || t.votes.some((v) => v.teamId === team.id)) continue;
      const approve = Math.random() < 0.7;
      await trades.vote(asUser(team.owner), league.id, t.id, approve);
      console.log(`${team.name} voted ${approve ? "for" : "against"} a trade.`);
      did = true;
    }
  }

  if (values.offer) {
    const ctx = await season.context(league.id);
    const squad = (id: string) => ctx.teams.find((t) => t.id === id)!.squad;
    const teams = [...demo.values()].sort(() => Math.random() - 0.5);
    const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
    for (let attempt = 0; attempt < 30; attempt++) {
      const from = teams[attempt % teams.length]!;
      const want = pick(squad(mine.id));
      const give = want && pick(squad(from.id).filter((p) => p.positions.some((pos) => want.positions.includes(pos))));
      if (!want || !give) continue;
      try {
        await trades.propose(asUser(from.owner), league.id, {
          fromTeamId: from.id,
          toTeamId: mine.id,
          give: [give.id],
          get: [want.id],
          message: "How about this one?",
        });
      } catch {
        continue; // A locked player or similar: try another pair.
      }
      console.log(`${from.name} offered ${ctx.players.get(give.id)?.name} for your ${ctx.players.get(want.id)?.name}.`);
      return;
    }
    console.log("No demo manager could find a trade to offer right now.");
    return;
  }
  if (!did) console.log("Nothing for the demo managers to do: no offers to them and no trades to vote on.");
}

try {
  if (command === "setup") await setup();
  else if (command === "advance") await advance();
  else if (command === "round") await goToRound();
  else if (command === "cpu") await cpu();
  else if (command === "status") await status();
  else throw new Error(`Unknown command "${command}". Use setup, round, advance, cpu or status.`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
