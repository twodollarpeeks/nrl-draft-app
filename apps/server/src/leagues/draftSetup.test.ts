import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE_SETTINGS, type LeagueDetail } from "@nrl/shared";
import { createUser, hasTestDb, resetDb, testDb } from "../../../../test/db.ts";
import { buildApp } from "../app.ts";
import type { DraftEngine } from "../draft/engine.ts";
import { DraftTimers, type TimerApi } from "../draft/timers.ts";
import { loadEnv } from "../env.ts";

describe.runIf(hasTestDb)("draft time and draft order", () => {
  const db = testDb();
  let clock = new Date("2026-10-01T10:00:00Z");
  const noTimers: TimerApi = { setTimeout: () => 0, clearTimeout: () => {} };
  const startTimers = new DraftTimers(() => {}, () => clock.getTime(), noTimers);

  const appPromise = buildApp({
    env: loadEnv({ NODE_ENV: "test" }),
    db,
    // Deterministic "random": reverse the order.
    leagues: { now: () => clock, shuffle: (ids) => [...ids].reverse() },
    draft: { now: () => clock, timers: new DraftTimers(() => {}, () => clock.getTime(), noTimers), startTimers },
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

  beforeEach(async () => {
    await resetDb(db);
    clock = new Date("2026-10-01T10:00:00Z");
    startTimers.cancelAll();
    // One player with 2026 stats, so a draft has a pool to start with.
    await db.club.create({ data: { id: 1, key: "storm", nickName: "Storm" } });
    const round = await db.round.create({ data: { season: 2026, number: 1, title: "R1", slug: "round-1", byeClubKeys: [] } });
    await db.match.create({ data: { id: "m1", roundId: round.id, homeClubId: 1, awayClubId: 1, kickoffAt: new Date(), url: "/m1", state: "FullTime" } });
    await db.player.create({ data: { id: 1, firstName: "A", lastName: "Player", positions: ["FB"], positionsOverride: [] } });
    await db.appearance.create({
      data: { matchId: "m1", playerId: 1, clubId: 1, jersey: 1, positionLabel: "Fullback", isStarter: true, minutes: 80, stats: { tries: 1 } },
    });
  });
  afterAll(async () => {
    await (await appPromise).close();
    await db.$disconnect();
  });

  /** A 4-team league; returns the commissioner, the invite code and helpers. */
  async function league(extra: Record<string, unknown> = {}, teamCount = 4) {
    const owner = await createUser(db, "Owner");
    const res = await call<LeagueDetail>(owner.id, "POST", "/api/leagues", {
      name: "Order Test", season: 2027, settings: { ...DEFAULT_LEAGUE_SETTINGS, teamCount }, ...extra,
    });
    expect(res.status).toBe(201);
    const join = async (name: string) => {
      const u = await createUser(db, name);
      const r = await call<LeagueDetail>(u.id, "POST", `/api/invites/${res.body.inviteCode}/join`, {});
      expect(r.status).toBe(200);
      return { user: u, league: r.body };
    };
    return { owner, created: res.body, id: res.body.id, join };
  }

  describe("randomise & lock when full (default)", () => {
    it("has no order until the league fills, then draws and locks it", async () => {
      const l = await league();
      expect(l.created).toMatchObject({ draftOrderMode: "randomWhenFull", draftOrder: [], draftOrderLocked: false });
      await l.join("B");
      const third = await l.join("C");
      expect(third.league.draftOrder).toEqual([]);
      const full = (await l.join("D")).league;
      expect(full.draftOrderLocked).toBe(true);
      expect(full.draftOrder).toEqual(full.teams.map((t) => t.id).reverse());
      expect(await db.auditLog.count({ where: { leagueId: l.id, action: "draft.order.drawn" } })).toBe(1);
    });

    it("draws when the commissioner shrinks the league to the teams already in it", async () => {
      const l = await league({}, 5);
      for (const n of ["B", "C", "D"]) await l.join(n);
      const res = await call<LeagueDetail>(l.owner.id, "PATCH", `/api/leagues/${l.id}`, {
        settings: { ...l.created.settings, teamCount: 4 },
      });
      expect(res.body.draftOrderLocked).toBe(true);
      expect(res.body.draftOrder).toHaveLength(4);
    });

    it("can't be rearranged once locked, nor switched to manual", async () => {
      const l = await league();
      for (const n of ["B", "C", "D"]) await l.join(n);
      const order = (await call<LeagueDetail>(l.owner.id, "GET", `/api/leagues/${l.id}`)).body.draftOrder;
      expect(await call(l.owner.id, "PUT", `/api/leagues/${l.id}/draft-order`, { teamIds: [...order].reverse() })).toMatchObject({
        status: 409, body: { error: "order_locked" },
      });
      expect(await call(l.owner.id, "PATCH", `/api/leagues/${l.id}`, { draftOrderMode: "manual" })).toMatchObject({
        status: 409, body: { error: "order_locked" },
      });
    });

    it("refuses manual arranging in random mode", async () => {
      const l = await league();
      expect(await call(l.owner.id, "POST", `/api/leagues/${l.id}/draft-order/randomise`)).toMatchObject({
        status: 409, body: { error: "order_random" },
      });
    });
  });

  describe("manual order", () => {
    it("adds teams to the end as they join, and lets the commissioner rearrange or shuffle", async () => {
      const l = await league({ draftOrderMode: "manual" });
      expect(l.created.draftOrder).toEqual([l.created.myTeamId]);
      const b = await l.join("B");
      const c = await l.join("C");
      const ids = c.league.teams.map((t) => t.id);
      expect(c.league.draftOrder).toEqual(ids);

      expect((await call(b.user.id, "PUT", `/api/leagues/${l.id}/draft-order`, { teamIds: ids })).status).toBe(403);
      expect((await call(l.owner.id, "PUT", `/api/leagues/${l.id}/draft-order`, { teamIds: ids.slice(1) })).status).toBe(400);
      const set = await call<LeagueDetail>(l.owner.id, "PUT", `/api/leagues/${l.id}/draft-order`, { teamIds: [ids[2], ids[0], ids[1]] });
      expect(set.body.draftOrder).toEqual([ids[2], ids[0], ids[1]]);

      const shuffled = await call<LeagueDetail>(l.owner.id, "POST", `/api/leagues/${l.id}/draft-order/randomise`);
      expect(shuffled.body.draftOrder).toEqual([...ids].reverse());
      expect(shuffled.body.draftOrderLocked).toBe(false);
    });

    it("switching back to random draws straight away if the league is already full", async () => {
      const l = await league({ draftOrderMode: "manual" });
      for (const n of ["B", "C", "D"]) await l.join(n);
      const res = await call<LeagueDetail>(l.owner.id, "PATCH", `/api/leagues/${l.id}`, { draftOrderMode: "randomWhenFull" });
      expect(res.body).toMatchObject({ draftOrderMode: "randomWhenFull", draftOrderLocked: true });
      expect(res.body.draftOrder).toHaveLength(4);
    });
  });

  describe("draft time", () => {
    it("must be in the future, and can be changed or cleared before the draft", async () => {
      const owner = await createUser(db, "Owner");
      const past = await call(owner.id, "POST", "/api/leagues", {
        name: "Past", season: 2027, settings: DEFAULT_LEAGUE_SETTINGS, draftAt: "2026-09-30T10:00:00Z",
      });
      expect(past).toMatchObject({ status: 400, body: { error: "draft_in_past" } });

      const l = await league({ draftAt: "2026-10-08T09:30:00+10:00" });
      expect(l.created.draftAt).toBe("2026-10-07T23:30:00.000Z");
      expect(startTimers.has(l.id)).toBe(true);

      const moved = await call<LeagueDetail>(l.owner.id, "PATCH", `/api/leagues/${l.id}`, { draftAt: "2026-10-09T09:30:00Z" });
      expect(moved.body.draftAt).toBe("2026-10-09T09:30:00.000Z");
      const cleared = await call<LeagueDetail>(l.owner.id, "PATCH", `/api/leagues/${l.id}`, { draftAt: null });
      expect(cleared.body.draftAt).toBeNull();
      expect(startTimers.has(l.id)).toBe(false);
    });

    it("starts the draft by itself at the scheduled time, using the locked order", async () => {
      const l = await league({ draftAt: "2026-10-01T12:00:00Z" });
      let full!: LeagueDetail;
      for (const n of ["B", "C", "D"]) full = (await l.join(n)).league;
      const e = await engine();

      expect(await e.autoStartIfDue(l.id)).toBe(false); // not time yet
      clock = new Date("2026-10-01T12:00:01Z");
      expect(await e.autoStartIfDue(l.id)).toBe(true);
      const state = await e.publicState(l.id);
      expect(state.status).toBe("live");
      expect(state.order.map((t) => t.id)).toEqual(full.draftOrder);
      expect(await e.autoStartIfDue(l.id)).toBe(false); // already started

      // Too late to change the time now.
      expect(await call(l.owner.id, "PATCH", `/api/leagues/${l.id}`, { draftAt: "2026-10-05T12:00:00Z" })).toMatchObject({
        status: 409, body: { error: "league_started" },
      });
    }, 60_000);

    it("doesn't start with fewer than 4 teams, on time or by hand", async () => {
      const l = await league({ draftAt: "2026-10-01T12:00:00Z" });
      for (const n of ["B", "C"]) await l.join(n);
      clock = new Date("2026-10-01T12:05:00Z");
      expect(await (await engine()).autoStartIfDue(l.id)).toBe(false);
      expect(await call(l.owner.id, "POST", `/api/leagues/${l.id}/draft/start`)).toMatchObject({
        status: 409, body: { error: "not_enough_teams" },
      });
      // Still in setup and still loadable.
      expect(await call(l.owner.id, "GET", `/api/leagues/${l.id}`)).toMatchObject({ status: 200, body: { status: "setup" } });
    });

    it("re-arms scheduled starts after a restart", async () => {
      const l = await league({ draftAt: "2026-10-01T12:00:00Z" });
      startTimers.cancelAll();
      await (await engine()).recover();
      expect(startTimers.has(l.id)).toBe(true);
    });
  });
});
