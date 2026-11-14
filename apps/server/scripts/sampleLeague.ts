// Builds the sample league: a finished draft and a season under way or done.
// Used by `npm run seed` and `npm run test-league`.

import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@nrl/db";
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

export const SEED_ACTION = "league.seed";
const TEAM_NAMES = [
  "Bondi Bulldozers", "Penrith Panthers Fan Club", "Cronulla Sharknado", "Brookvale Bombers",
  "Redfern Rabbits", "Parramatta Powerhouse", "Townsville Tremors", "Canberra Cannons",
  "Wollongong Wave", "Newcastle Knockers", "Gold Coast Gliders", "Melbourne Muscle",
  "Auckland Avalanche", "Leichhardt Legends", "Brisbane Bruisers", "Redcliffe Rippers", "Perth Prowlers",
];

export async function deleteSampleLeagues(db: PrismaClient) {
  const seeded = await db.auditLog.findMany({ where: { action: SEED_ACTION }, select: { leagueId: true } });
  const ids = [...new Set(seeded.map((s) => s.leagueId))];
  const deleted = await db.league.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { email: { endsWith: "@seed.invalid" } } });
  return deleted.count;
}

export interface SampleLeagueOptions {
  owner: { id: string; name: string } | null;
  teamCount: number;
  season: number;
  name: string;
  /** Season whose stats rank the draft (default: `season`). */
  rankSeason?: number;
  /** When the draft finished, for picking the first round (default: now). */
  seasonStartsAt?: Date;
}

/** Create the sample league (call deleteSampleLeagues first to replace one). */
export async function createSampleLeague(db: PrismaClient, opts: SampleLeagueOptions) {
  const { season, teamCount } = opts;
  const now = new Date();
  // Managers: the owner (if given) plus demo managers.
  const managers: Array<{ id: string; name: string }> = opts.owner ? [opts.owner] : [];
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
      name: opts.name,
      season,
      commissionerId: managers[0]!.id,
      inviteCode: randomBytes(4).toString("hex").toUpperCase(),
      settings,
      status: "drafting",
      draftOrderMode: "randomWhenFull",
      draftOrderLocked: true,
      teams: {
        create: managers.map((m, i) => ({ ownerId: m.id, name: i === 0 && opts.owner ? `${m.name.split(" ")[0]}'s Team` : TEAM_NAMES[i % TEAM_NAMES.length]! })),
      },
    },
    include: { teams: true },
  });
  await db.auditLog.create({ data: { leagueId: league.id, actorId: managers[0]!.id, action: SEED_ACTION } });

  // Draft: random order, every pick made by the same rules as autopick.
  const order = league.teams.map((t) => t.id).sort(() => Math.random() - 0.5);
  const players = await loadDraftPlayers(db, opts.rankSeason ?? season, settings.scoring);
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
      await startSeason(tx, league.id, order, opts.seasonStartsAt ?? now);
    },
    { timeout: 60_000 },
  );

  return { league, totalPicks };
}
