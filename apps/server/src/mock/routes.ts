import type { PrismaClient } from "@nrl/db";
import {
  DEFAULT_ROSTER_TEMPLATE,
  MockDraftInput,
  checkDraftable,
  squadSize,
  teamForPick,
  type DraftPlayer,
  type MockDraftDetail,
  type MockDraftSummary,
  type MockPickView,
  type MockPool,
  type NrlPosition,
  type RosterTemplate,
} from "@nrl/shared";
import type { FastifyInstance } from "fastify";
import { latestSeason, rankPlayers } from "../draft/rankings.ts";
import { AppError, notFound } from "../errors.ts";
import type { Guards } from "../guards.ts";
import { getSiteConfig } from "../siteConfig.ts";

/** Saved mocks kept per user; older ones are dropped. */
export const MOCK_HISTORY_LIMIT = 50;
const POOL_TTL_MS = 10 * 60_000;

const invalid = (message: string) => new AppError(400, "invalid_mock", message);

/**
 * Solo mock drafts. The draft itself runs in the browser; the server hands
 * out the player pool and keeps finished mocks, checking they follow the
 * draft rules before saving.
 */
export function registerMockRoutes(app: FastifyInstance, db: PrismaClient, { requireUser }: Guards) {
  // Ranking the pool is one aggregate query; share it between users for a while.
  let cached: { at: number; key: string; pool: MockPool } | null = null;

  async function pool(): Promise<MockPool> {
    const [season, config] = await Promise.all([latestSeason(db), getSiteConfig(db)]);
    const key = JSON.stringify([season, config.defaultScoring]);
    if (cached && cached.key === key && Date.now() - cached.at < POOL_TTL_MS) return cached.pool;
    const players = season === null ? [] : await rankPlayers(db, season, config.defaultScoring);
    const fresh: MockPool = { season, roster: DEFAULT_ROSTER_TEMPLATE, scoring: config.defaultScoring, players };
    cached = { at: Date.now(), key, pool: fresh };
    return fresh;
  }

  app.get("/api/mock/pool", async (req) => {
    await requireUser(req);
    return pool();
  });

  app.get("/api/mock-drafts", async (req): Promise<MockDraftSummary[]> => {
    const user = await requireUser(req);
    const rows = await db.mockDraft.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: MOCK_HISTORY_LIMIT,
    });
    return rows.map((r) => {
      const picks = r.picks as unknown as MockPickView[];
      const mine = picks.filter((p) => teamIndexForPick(r.teamCount, p.pickNo) === r.slot - 1);
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        season: r.season,
        teamCount: r.teamCount,
        slot: r.slot,
        firstPicks: mine.slice(0, 3).map((p) => p.name),
      };
    });
  });

  app.get<{ Params: { id: string } }>("/api/mock-drafts/:id", async (req) => {
    const user = await requireUser(req);
    const row = await db.mockDraft.findFirst({ where: { id: req.params.id, userId: user.id } });
    if (!row) throw notFound("Mock draft");
    return toDetail(row);
  });

  app.post("/api/mock-drafts", async (req, reply) => {
    const user = await requireUser(req);
    const input = MockDraftInput.parse(req.body);
    const { players, season, roster } = await pool();
    if (season === null) throw invalid("There's no player data to draft from yet");
    const picks = checkMock(input, roster, new Map(players.map((p) => [p.id, p])));

    const row = await db.$transaction(async (tx) => {
      const created = await tx.mockDraft.create({
        data: {
          userId: user.id,
          season,
          teamCount: input.teamCount,
          slot: input.slot,
          pickSeconds: input.pickSeconds,
          settings: { roster, teamNames: input.teamNames },
          picks: picks as unknown as object[],
        },
      });
      // Keep the most recent ones only.
      const old = await tx.mockDraft.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        skip: MOCK_HISTORY_LIMIT,
        select: { id: true },
      });
      if (old.length) await tx.mockDraft.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
      return created;
    });
    return reply.status(201).send(toDetail(row));
  });

  app.delete<{ Params: { id: string } }>("/api/mock-drafts/:id", async (req, reply) => {
    const user = await requireUser(req);
    const { count } = await db.mockDraft.deleteMany({ where: { id: req.params.id, userId: user.id } });
    if (!count) throw notFound("Mock draft");
    return reply.status(204).send();
  });
}

/** Round-1 index of the team making `pickNo` (snake order). */
function teamIndexForPick(teamCount: number, pickNo: number): number {
  return teamForPick(Array.from({ length: teamCount }, (_, i) => i), pickNo);
}

/** Checks a finished mock follows the draft rules; returns its picks with player details. */
export function checkMock(
  input: MockDraftInput,
  roster: RosterTemplate,
  players: ReadonlyMap<number, DraftPlayer>,
): MockPickView[] {
  if (input.slot > input.teamCount) throw invalid("Your draft slot is outside the league");
  if (input.teamNames.length !== input.teamCount) throw invalid("Every team needs a name");
  const total = input.teamCount * squadSize(roster);
  if (input.picks.length !== total) throw invalid(`A finished mock has ${total} picks`);

  const taken = new Set<number>();
  const rosters: NrlPosition[][][] = Array.from({ length: input.teamCount }, () => []);
  return input.picks.map((playerId, i) => {
    const pickNo = i + 1;
    const p = players.get(playerId);
    if (!p) throw invalid(`Pick ${pickNo} isn't in the player pool`);
    if (taken.has(playerId)) throw invalid(`${p.name} was picked twice`);
    const team = rosters[teamIndexForPick(input.teamCount, pickNo)]!;
    const check = checkDraftable(roster, team, p.positions);
    if (!check.ok) throw invalid(`Pick ${pickNo} (${p.name}): ${check.reason}`);
    taken.add(playerId);
    team.push(p.positions);
    return { pickNo, playerId, name: p.name, positions: p.positions, club: p.club?.nickName ?? null, avgPoints: p.avgPoints };
  });
}

function toDetail(row: {
  id: string;
  createdAt: Date;
  season: number;
  teamCount: number;
  slot: number;
  pickSeconds: number;
  settings: unknown;
  picks: unknown;
}): MockDraftDetail {
  const settings = row.settings as { roster: RosterTemplate; teamNames: string[] };
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    season: row.season,
    teamCount: row.teamCount,
    slot: row.slot,
    pickSeconds: row.pickSeconds,
    roster: settings.roster,
    teamNames: settings.teamNames,
    picks: row.picks as MockPickView[],
  };
}
