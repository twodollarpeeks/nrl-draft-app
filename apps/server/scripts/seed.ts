// Sample league for local testing and demos: a finished draft and a scored
// season, built from an already-imported NRL season (2026 by default).
//
//   npm run seed -- --owner you@gmail.com            (you're the commissioner)
//   npm run seed -- --owner you@gmail.com --teams 10 --season 2026
//   npm run seed -- --reset                          (just delete sample leagues)
//
// The owner must have signed in once (accounts come from Google). Without
// --owner a demo manager is the commissioner. Re-running replaces the previous
// sample league. Demo managers use @seed.invalid emails and can't sign in.

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createPrisma } from "@nrl/db";
import {
  DEFAULT_LEAGUE_SETTINGS,
  DEFAULT_SITE_CONFIG,
  chooseAutopick,
  fitFinalsToTeams,
  roundOf,
  squadSize,
  teamForPick,
  type LeagueSettings,
  type NrlPosition,
} from "@nrl/shared";
import { loadDraftPlayers } from "../src/draft/rankings.ts";
import { startSeason } from "../src/season/setup.ts";
import { getSiteConfig } from "../src/siteConfig.ts";

const { values } = parseArgs({
  options: {
    owner: { type: "string" },
    teams: { type: "string", default: "8" },
    season: { type: "string", default: "2026" },
    name: { type: "string", default: "Sample League" },
    reset: { type: "boolean", default: false },
  },
});

const SEED_ACTION = "league.seed";
const TEAM_NAMES = [
  "Bondi Bulldozers", "Penrith Panthers Fan Club", "Cronulla Sharknado", "Brookvale Bombers",
  "Redfern Rabbits", "Parramatta Powerhouse", "Townsville Tremors", "Canberra Cannons",
  "Wollongong Wave", "Newcastle Knockers", "Gold Coast Gliders", "Melbourne Muscle",
  "Auckland Avalanche", "Leichhardt Legends", "Brisbane Bruisers", "Redcliffe Rippers", "Perth Prowlers",
];

const db = createPrisma();
const now = new Date();

async function deleteSampleLeagues() {
  const seeded = await db.auditLog.findMany({ where: { action: SEED_ACTION }, select: { leagueId: true } });
  const ids = [...new Set(seeded.map((s) => s.leagueId))];
  const deleted = await db.league.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { email: { endsWith: "@seed.invalid" } } });
  return deleted.count;
}

try {
  if (values.reset) {
    console.log(`Removed ${await deleteSampleLeagues()} sample league(s).`);
    process.exit(0);
  }

  // Check everything before touching the existing sample league.
  const season = Number(values.season);
  const teamCount = Number(values.teams);
  if (!Number.isInteger(teamCount) || teamCount < 4 || teamCount > 18) throw new Error("--teams must be 4-18");
  if ((await db.round.count({ where: { season } })) === 0) {
    throw new Error(`No ${season} data. Import it first: npm run nrl:import -- --season ${season}`);
  }
  const owner = values.owner ? await db.user.findUnique({ where: { email: values.owner.toLowerCase() } }) : null;
  if (values.owner && !owner) {
    throw new Error(`No account for ${values.owner}. Sign in with Google once, then run this again.`);
  }

  const removed = await deleteSampleLeagues();
  if (removed) console.log(`Replacing the previous sample league.`);

  // Managers: the owner (if given) plus demo managers.
  const managers: Array<{ id: string; name: string }> = owner ? [owner] : [];
  for (let i = managers.length; i < teamCount; i++) {
    const id = `seed_${randomBytes(6).toString("hex")}`;
    const user = await db.user.create({
      data: { id, name: `Demo Manager ${i + 1}`, email: `demo${i + 1}@seed.invalid`, emailVerified: true, createdAt: now, updatedAt: now },
    });
    managers.push(user);
  }

  // Settings: the site's default scoring and rules, sized to the league.
  const config = (await getSiteConfig(db)) ?? DEFAULT_SITE_CONFIG;
  const base = DEFAULT_LEAGUE_SETTINGS;
  const settings: LeagueSettings = {
    ...base,
    teamCount,
    scoring: config.defaultScoring,
    matchups:
      base.matchups.mode === "headToHead"
        ? { ...base.matchups, finalsTeams: fitFinalsToTeams(base.matchups.finalsTeams, teamCount) }
        : base.matchups,
  };

  const league = await db.league.create({
    data: {
      name: values.name!,
      season,
      commissionerId: managers[0]!.id,
      inviteCode: randomBytes(4).toString("hex").toUpperCase(),
      settings,
      status: "drafting",
      draftOrderMode: "randomWhenFull",
      draftOrderLocked: true,
      teams: {
        create: managers.map((m, i) => ({ ownerId: m.id, name: i === 0 && values.owner ? `${m.name.split(" ")[0]}'s Team` : TEAM_NAMES[i % TEAM_NAMES.length]! })),
      },
    },
    include: { teams: true },
  });
  await db.auditLog.create({ data: { leagueId: league.id, actorId: managers[0]!.id, action: SEED_ACTION } });

  // Draft: random order, every pick made by the same rules as autopick.
  const order = league.teams.map((t) => t.id).sort(() => Math.random() - 0.5);
  const players = await loadDraftPlayers(db, season, settings.scoring);
  const positions = new Map(players.map((p) => [p.id, p.positions]));
  const ranked = players.map((p) => p.id);
  const totalPicks = order.length * squadSize(settings.roster);
  const taken = new Set<number>();
  const rosters = new Map<string, NrlPosition[][]>(order.map((id) => [id, []]));
  const picks: Array<{ pickNo: number; round: number; teamId: string; playerId: number }> = [];
  for (let pickNo = 1; pickNo <= totalPicks; pickNo++) {
    const teamId = teamForPick(order, pickNo);
    const choice = chooseAutopick({
      template: settings.roster,
      roster: rosters.get(teamId)!,
      queue: [],
      ranked,
      isAvailable: (id) => !taken.has(id),
      positionsOf: (id) => positions.get(id) ?? [],
    });
    if (choice === null) throw new Error(`Ran out of players at pick ${pickNo}: try fewer teams`);
    taken.add(choice);
    rosters.get(teamId)!.push(positions.get(choice) ?? []);
    picks.push({ pickNo, round: roundOf(order.length, pickNo), teamId, playerId: choice });
  }

  await db.$transaction(
    async (tx) => {
      const draft = await tx.draft.create({
        data: {
          leagueId: league.id, status: "complete", pickSeconds: settings.draft.pickSeconds, order,
          totalPicks, currentPick: totalPicks + 1, completedAt: now,
        },
      });
      await tx.draftPick.createMany({ data: picks.map((p) => ({ ...p, draftId: draft.id, madeBy: "autopick" })) });
      await tx.rosterEntry.createMany({
        data: picks.map((p) => ({ leagueId: league.id, teamId: p.teamId, playerId: p.playerId, acquiredVia: "draft" })),
      });
      await tx.league.update({ where: { id: league.id }, data: { status: "inSeason", draftOrder: order } });
      await startSeason(tx, league.id, order, now);
    },
    { timeout: 60_000 },
  );

  console.log(`Created "${league.name}" (${season}, ${teamCount} teams, ${totalPicks} picks).`);
  console.log(`Open it at /l/${league.id}`);
  if (!values.owner) console.log("Tip: add --owner you@gmail.com to be in it yourself.");
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
