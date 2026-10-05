import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LEAGUE_SETTINGS,
  startersFillable,
  starterCount,
  type DraftPlayer,
  type DraftState,
  type LeagueSettings,
  type NrlPosition,
} from "@nrl/shared";
import type { PrismaClient } from "@nrl/db";
import { createUser, hasTestDb, resetDb, testDb } from "../../../../test/db.ts";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { AUTOPILOT_DELAY_MS, type DraftEngine } from "./engine.ts";
import { rankScore } from "./rankings.ts";
import { DraftTimers, type TimerApi } from "./timers.ts";

describe("rankScore", () => {
  it("shrinks small samples", () => {
    expect(rankScore(50, 1)).toBeLessThan(rankScore(40, 20));
  });
});

// A small squad keeps a full test draft quick: 3 starters + 1 bench.
const SETTINGS: LeagueSettings = {
  ...DEFAULT_LEAGUE_SETTINGS,
  teamCount: 4,
  roster: {
    slots: [
      { key: "HB_HK", label: "HB/HK", count: 1, eligible: ["HB", "FE", "HK"] },
      { key: "FWD", label: "Forward", count: 1, eligible: ["FRF", "2RF", "LK"] },
      { key: "OB", label: "Outside Back", count: 1, eligible: ["FB", "WG", "CE"] },
    ],
    benchSize: 1,
  },
  draft: { type: "snake", pickSeconds: 60 },
  scoring: { runMetres: 0.1, tackles: 1, tries: 6, tryAssists: 4, goals: 2, errors: -4 },
};

/** 30 players across positions with 2026 stats; lower id = more tries = higher rank. */
async function seedPool(db: PrismaClient) {
  await db.club.create({ data: { id: 1, key: "storm", nickName: "Storm" } });
  await db.club.create({ data: { id: 2, key: "broncos", nickName: "Broncos" } });
  const round = await db.round.create({
    data: { season: 2026, number: 1, title: "Round 1", slug: "round-1", byeClubKeys: [] },
  });
  await db.match.create({
    data: {
      id: "m1", roundId: round.id, homeClubId: 1, awayClubId: 2, kickoffAt: new Date("2026-03-05T09:00:00Z"),
      url: "/m1", state: "FullTime",
    },
  });
  const cycle: NrlPosition[] = ["HB", "FRF", "WG", "2RF", "CE", "HK", "FB", "LK", "FE", "FRF"];
  for (let i = 1; i <= 30; i++) {
    await db.player.create({
      data: { id: i, firstName: "P", lastName: String(i).padStart(2, "0"), clubId: 1, positions: [cycle[(i - 1) % 10]!], positionsOverride: [] },
    });
    await db.appearance.create({
      data: {
        matchId: "m1", playerId: i, clubId: 1, jersey: i, positionLabel: "x", isStarter: true,
        minutes: 80, runMetres: 100, tackles: 10, tries: 31 - i, tryAssists: 0, goals: 0, errors: 0,
        stats: { minutesPlayed: 80, allRunMetres: 100, tacklesMade: 10, tries: 31 - i },
      },
    });
  }
}

describe.runIf(hasTestDb)("draft room", () => {
  const db = testDb();
  let clock = new Date("2026-10-01T10:00:00Z");
  const scheduled: Array<{ fn: () => void; ms: number }> = [];
  const fakeTimers: TimerApi = {
    setTimeout: (fn, ms) => scheduled.push({ fn, ms }) - 1,
    clearTimeout: () => {},
  };
  const timers = new DraftTimers(() => {}, () => clock.getTime(), fakeTimers);
  const appPromise = buildApp({
    env: loadEnv({ NODE_ENV: "test" }),
    db,
    draft: { now: () => clock, timers },
    getUser: async (req) => {
      const id = req.headers["x-test-user"];
      const u = typeof id === "string" ? await db.user.findUnique({ where: { id } }) : null;
      return u && { id: u.id, name: u.name, email: u.email, image: u.image };
    },
  });
  const engine = async () => (await appPromise).draftEngine as DraftEngine;

  async function call<T = unknown>(userId: string, method: string, url: string, body?: unknown) {
    const res = await (await appPromise).inject({
      method: method as "GET",
      url,
      headers: { "x-test-user": userId },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    return { status: res.statusCode, body: res.json() as T };
  }

  let leagueId = "";
  let users: Array<{ id: string }> = []; // users[0] is the commissioner
  let teamOf: Record<string, string> = {}; // userId -> teamId
  const base = () => `/api/leagues/${leagueId}/draft`;
  const tick = (ms: number) => (clock = new Date(clock.getTime() + ms));

  beforeEach(async () => {
    await resetDb(db);
    clock = new Date("2026-10-01T10:00:00Z");
    await seedPool(db);
    users = [];
    for (let i = 0; i < 4; i++) users.push(await createUser(db, `Manager ${i}`));
    const created = await call<{ id: string; inviteCode: string }>(users[0]!.id, "POST", "/api/leagues", {
      name: "Draft Test", season: 2027, settings: SETTINGS,
    });
    leagueId = created.body.id;
    for (const u of users.slice(1)) await call(u.id, "POST", `/api/invites/${created.body.inviteCode}/join`, {});
    const teams = await db.team.findMany({ where: { leagueId } });
    teamOf = Object.fromEntries(teams.map((t) => [t.ownerId, t.id]));
  });
  afterAll(async () => {
    await (await appPromise).close();
    await db.$disconnect();
  });

  /** Start with the draft order = users[0..3]. */
  async function startInUserOrder() {
    const e = await engine();
    const order = users.map((u) => teamOf[u.id]!);
    await db.league.update({ where: { id: leagueId }, data: { draftOrderMode: "manual", draftOrderLocked: false, draftOrder: order } });
    return e.start({ id: users[0]!.id, name: "", email: "", image: null, isAdmin: false }, leagueId);
  }
  const userOnClock = (s: DraftState) => users.find((u) => teamOf[u.id] === s.onClockTeamId)!;

  it("ranks the pool under the league's scoring, using the previous season's stats", async () => {
    const res = await call<DraftPlayer[]>(users[1]!.id, "GET", `${base()}/players`);
    expect(res.body).toHaveLength(30);
    expect(res.body[0]).toMatchObject({ id: 1, rank: 1, statsSeason: 2026, games: 1 });
    // 30 tries x 6 + 100m x 0.1 + 10 tackles = 200
    expect(res.body[0]!.avgPoints).toBe(200);
  });

  it("is pending before the start, and queues can be set in advance", async () => {
    const state = await call<DraftState>(users[1]!.id, "GET", base());
    expect(state.body).toMatchObject({ status: "pending", onClockTeamId: null, picks: [] });
    const q = await call<number[]>(users[1]!.id, "PUT", `${base()}/queue`, { playerIds: [5, 3, 5] });
    expect(q.body).toEqual([5, 3]);
    expect((await call<number[]>(users[1]!.id, "GET", `${base()}/queue`)).body).toEqual([5, 3]);
    expect((await call(users[1]!.id, "PUT", `${base()}/queue`, { playerIds: [999] })).status).toBe(400);
  });

  it("only the commissioner can start, and starting locks the league", async () => {
    expect((await call(users[1]!.id, "POST", `${base()}/start`)).status).toBe(403);
    const res = await call<DraftState>(users[0]!.id, "POST", `${base()}/start`);
    expect(res.body).toMatchObject({ status: "live", currentPick: 1, totalPicks: 16, rounds: 4 });
    expect(res.body.order).toHaveLength(4);
    expect(new Date(res.body.deadline!).getTime() - clock.getTime()).toBe(60_000);
    const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
    expect(league.status).toBe("drafting");
    expect(timers.has((await db.draft.findFirstOrThrow()).id)).toBe(true);
    expect((await call(users[0]!.id, "POST", `${base()}/start`)).status).toBe(409);
  });

  it("validates turn, pick number and availability", async () => {
    const s = await startInUserOrder();
    const first = userOnClock(s);
    expect(first.id).toBe(users[0]!.id);

    // Not your turn
    expect(await call(users[1]!.id, "POST", `${base()}/pick`, { pickNo: 1, playerId: 1 })).toMatchObject({
      status: 409, body: { error: "not_your_turn" },
    });
    // Right team, wrong pick number
    expect(await call(first.id, "POST", `${base()}/pick`, { pickNo: 2, playerId: 1 })).toMatchObject({
      status: 409, body: { error: "stale_pick" },
    });
    const ok = await call<DraftState>(first.id, "POST", `${base()}/pick`, { pickNo: 1, playerId: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ currentPick: 2, picks: [{ pickNo: 1, playerId: 1, madeBy: "manager" }] });
    expect(ok.body.onClockTeamId).toBe(teamOf[users[1]!.id]);
    expect(await db.rosterEntry.count({ where: { leagueId, playerId: 1 } })).toBe(1);

    // Same player again
    expect(await call(users[1]!.id, "POST", `${base()}/pick`, { pickNo: 2, playerId: 1 })).toMatchObject({
      status: 409, body: { error: "player_taken" },
    });
  });

  it("removes a drafted player from everyone's queue", async () => {
    await call(users[1]!.id, "PUT", `${base()}/queue`, { playerIds: [1, 2] });
    await startInUserOrder();
    await call(users[0]!.id, "POST", `${base()}/pick`, { pickNo: 1, playerId: 1 });
    expect((await call<number[]>(users[1]!.id, "GET", `${base()}/queue`)).body).toEqual([2]);
  });

  it("lets exactly one of several simultaneous picks through", async () => {
    await startInUserOrder();
    const attempts = await Promise.all([
      call(users[0]!.id, "POST", `${base()}/pick`, { pickNo: 1, playerId: 1 }),
      call(users[0]!.id, "POST", `${base()}/pick`, { pickNo: 1, playerId: 2 }),
      call(users[0]!.id, "POST", `${base()}/pick`, { pickNo: 1, playerId: 3 }),
    ]);
    expect(attempts.filter((a) => a.status === 200)).toHaveLength(1);
    expect(await db.draftPick.count()).toBe(1);
  }, 60_000);

  it("lets the commissioner pick for the team on the clock", async () => {
    await startInUserOrder();
    await call(users[0]!.id, "POST", `${base()}/pick`, { pickNo: 1, playerId: 1 });
    const res = await call<DraftState>(users[0]!.id, "POST", `${base()}/pick`, { pickNo: 2, playerId: 2 });
    expect(res.body.picks[1]).toMatchObject({ teamId: teamOf[users[1]!.id], madeBy: "commissioner" });
  });

  it("enforces filling starting spots with late picks", async () => {
    await startInUserOrder();
    // users[0] picks 1 (HB) and, in round 2 (pick 8), 2 (FRF) -> needs an OB in
    // its last two picks; with one bench spot it could still take anyone at
    // pick 9, but by pick 16 it must take an outside back.
    const e = await engine();
    const pickFor = async (pickNo: number, playerId: number) =>
      e.pick({ id: users[0]!.id, name: "", email: "", image: null, isAdmin: false }, leagueId, { pickNo, playerId });
    await pickFor(1, 1); // HB  team0
    await pickFor(2, 4); // 2RF team1
    await pickFor(3, 5); // CE  team2
    await pickFor(4, 6); // HK  team3
    await pickFor(5, 7); // FB  team3
    await pickFor(6, 8); // LK  team2
    await pickFor(7, 9); // FE  team1
    await pickFor(8, 2); // FRF team0
    await pickFor(9, 10); // FRF team0 (bench)
    for (let p = 10; p <= 15; p++) await pickFor(p, [3, 11, 12, 13, 14, 15][p - 10]!);
    // Pick 16 is team0's last: it has HB, FRF, FRF and no outside back.
    const res = await call(users[0]!.id, "POST", `${base()}/pick`, { pickNo: 16, playerId: 20 }); // 20 = FRF
    expect(res).toMatchObject({ status: 409, body: { error: "cant_draft" } });
    expect((await call(users[0]!.id, "POST", `${base()}/pick`, { pickNo: 16, playerId: 17 })).status).toBe(200); // 17 = FB
  }, 60_000);

  describe("clock", () => {
    it("does nothing before the deadline or for a stale pick", async () => {
      await startInUserOrder();
      const e = await engine();
      const id = (await db.draft.findFirstOrThrow()).id;
      tick(59_000);
      expect(await e.autopickIfDue(id, 1)).toBe(false);
      tick(2_000);
      expect(await e.autopickIfDue(id, 2)).toBe(false);
      expect(await db.draftPick.count()).toBe(0);
    });

    it("autopicks from the queue when time runs out, then puts the team on autopilot", async () => {
      await call(users[0]!.id, "PUT", `${base()}/queue`, { playerIds: [9, 4] });
      await startInUserOrder();
      const e = await engine();
      const id = (await db.draft.findFirstOrThrow()).id;
      tick(61_000);
      expect(await e.autopickIfDue(id, 1)).toBe(true);
      const s = await e.publicState(leagueId);
      expect(s.picks[0]).toMatchObject({ playerId: 9, madeBy: "autopick" });
      expect(s.autopilotTeamIds).toEqual([teamOf[users[0]!.id]]);
      expect(await e.autopickIfDue(id, 1)).toBe(false); // duplicate timer: no second pick
    });

    it("autopicks best available with an empty queue", async () => {
      await startInUserOrder();
      const e = await engine();
      tick(61_000);
      await e.autopickIfDue((await db.draft.findFirstOrThrow()).id, 1);
      expect((await e.publicState(leagueId)).picks[0]!.playerId).toBe(1);
    });

    it("gives an autopilot team only a few seconds, and a manual pick switches autopilot off", async () => {
      await startInUserOrder();
      const e = await engine();
      const id = (await db.draft.findFirstOrThrow()).id;
      tick(61_000);
      await e.autopickIfDue(id, 1); // team0 now on autopilot
      for (let p = 2; p <= 4; p++) {
        const s = await e.publicState(leagueId);
        await call(userOnClock(s).id, "POST", `${base()}/pick`, { pickNo: p, playerId: 10 + p });
      }
      // Pick 5 is team3 again (snake), pick 8 is team0.
      for (let p = 5; p <= 7; p++) {
        const s = await e.publicState(leagueId);
        await call(userOnClock(s).id, "POST", `${base()}/pick`, { pickNo: p, playerId: 10 + p });
      }
      let s = await e.publicState(leagueId);
      expect(s.onClockTeamId).toBe(teamOf[users[0]!.id]);
      expect(new Date(s.deadline!).getTime() - clock.getTime()).toBe(AUTOPILOT_DELAY_MS);

      // The manager comes back and picks: autopilot off.
      await call(users[0]!.id, "POST", `${base()}/pick`, { pickNo: 8, playerId: 2 });
      s = await e.publicState(leagueId);
      expect(s.autopilotTeamIds).toEqual([]);
    }, 60_000);

    it("can be switched on and off by the manager", async () => {
      await startInUserOrder();
      const on = await call<DraftState>(users[0]!.id, "POST", `${base()}/autopilot`, { on: true });
      expect(on.body.autopilotTeamIds).toEqual([teamOf[users[0]!.id]]);
      // On the clock, so the deadline is pulled in.
      expect(new Date(on.body.deadline!).getTime() - clock.getTime()).toBe(AUTOPILOT_DELAY_MS);
      const off = await call<DraftState>(users[0]!.id, "POST", `${base()}/autopilot`, { on: false });
      expect(off.body.autopilotTeamIds).toEqual([]);
    });
  });

  it("pause keeps the remaining time; resume gives at least 10 seconds", async () => {
    await startInUserOrder();
    tick(20_000);
    expect((await call(users[1]!.id, "POST", `${base()}/pause`)).status).toBe(403);
    const paused = await call<DraftState>(users[0]!.id, "POST", `${base()}/pause`);
    expect(paused.body).toMatchObject({ status: "paused", deadline: null, pausedRemainingMs: 40_000 });
    expect((await call(users[0]!.id, "POST", `${base()}/pick`, { pickNo: 1, playerId: 1 })).body).toMatchObject({ error: "draft_paused" });
    tick(600_000);
    const resumed = await call<DraftState>(users[0]!.id, "POST", `${base()}/resume`);
    expect(new Date(resumed.body.deadline!).getTime() - clock.getTime()).toBe(40_000);
  });

  it("undo takes back the last pick and puts that team back on the clock", async () => {
    await startInUserOrder();
    await call(users[0]!.id, "POST", `${base()}/pick`, { pickNo: 1, playerId: 1 });
    await call(users[1]!.id, "POST", `${base()}/pick`, { pickNo: 2, playerId: 2 });
    expect((await call(users[1]!.id, "POST", `${base()}/undo`)).status).toBe(403);
    const res = await call<DraftState>(users[0]!.id, "POST", `${base()}/undo`);
    expect(res.body).toMatchObject({ currentPick: 2, onClockTeamId: teamOf[users[1]!.id] });
    expect(res.body.picks.map((p) => p.playerId)).toEqual([1]);
    expect(await db.rosterEntry.count({ where: { leagueId, playerId: 2 } })).toBe(0);
    expect(new Date(res.body.deadline!).getTime() - clock.getTime()).toBe(60_000);
  });

  it("runs a whole draft on autopick to a valid finish", async () => {
    await startInUserOrder();
    const e = await engine();
    const id = (await db.draft.findFirstOrThrow()).id;
    for (let p = 1; p <= 16; p++) {
      tick(61_000);
      expect(await e.autopickIfDue(id, p)).toBe(true);
    }
    const s = await e.publicState(leagueId);
    expect(s).toMatchObject({ status: "complete", onClockTeamId: null, deadline: null });
    expect((await db.league.findUniqueOrThrow({ where: { id: leagueId } })).status).toBe("inSeason");
    expect(timers.has(id)).toBe(false);

    // Every team has a full squad that can field a complete starting side.
    const players = await db.player.findMany();
    const pos = new Map(players.map((p) => [p.id, p.positions as NrlPosition[]]));
    for (const teamId of Object.values(teamOf)) {
      const mine = s.picks.filter((p) => p.teamId === teamId).map((p) => pos.get(p.playerId)!);
      expect(mine).toHaveLength(4);
      expect(startersFillable(SETTINGS.roster, mine)).toBe(starterCount(SETTINGS.roster));
    }

    // Undo after completion reopens the draft.
    const undone = await call<DraftState>(users[0]!.id, "POST", `${base()}/undo`);
    expect(undone.body.status).toBe("live");
    expect((await db.league.findUniqueOrThrow({ where: { id: leagueId } })).status).toBe("drafting");
  }, 120_000);

  it("hides the draft from non-members", async () => {
    const stranger = await createUser(db, "Stranger");
    expect((await call(stranger.id, "GET", base())).status).toBe(404);
  });

  it("recover() re-arms the clock for live drafts after a restart", async () => {
    await startInUserOrder();
    const id = (await db.draft.findFirstOrThrow()).id;
    timers.cancelAll();
    expect(timers.has(id)).toBe(false);
    expect(await (await engine()).recover()).toBe(1);
    expect(timers.has(id)).toBe(true);
  });
});
