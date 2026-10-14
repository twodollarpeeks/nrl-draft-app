import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  chooseAutopick,
  squadSize,
  teamForPick,
  type DraftPlayer,
  type MockDraftDetail,
  type MockDraftSummary,
  type MockPool,
  type NrlPosition,
} from "@nrl/shared";
import { createUser, hasTestDb, resetDb, testDb } from "../../../../test/db.ts";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { checkMock } from "./routes.ts";

describe.skipIf(!hasTestDb)("mock drafts", () => {
  const db = testDb();
  const appPromise = buildApp({
    env: loadEnv({ NODE_ENV: "test" }),
    db,
    getUser: async (req) => {
      const id = req.headers["x-test-user"];
      const u = typeof id === "string" ? await db.user.findUnique({ where: { id } }) : null;
      return u && { id: u.id, name: u.name, email: u.email, image: u.image };
    },
  });

  async function call<T = unknown>(userId: string, method: string, url: string, body?: unknown) {
    const res = await (await appPromise).inject({
      method: method as "GET",
      url,
      headers: { "x-test-user": userId },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    return { status: res.statusCode, body: (res.body ? res.json() : null) as T };
  }

  // 60 players across the three groups, all with 2026 stats.
  const GROUPS: NrlPosition[] = ["HB", "FRF", "WG"];
  beforeEach(async () => {
    await resetDb(db);
    await db.club.create({ data: { id: 1, key: "storm", nickName: "Storm" } });
    const round = await db.round.create({ data: { season: 2026, number: 1, title: "R1", slug: "round-1", byeClubKeys: [] } });
    await db.match.create({ data: { id: "m1", roundId: round.id, homeClubId: 1, awayClubId: 1, kickoffAt: new Date(), url: "/m1", state: "FullTime" } });
    for (let i = 1; i <= 60; i++) {
      await db.player.create({ data: { id: i, firstName: "P", lastName: String(i), positions: [GROUPS[i % 3]!], positionsOverride: [], clubId: 1 } });
      await db.appearance.create({
        data: { matchId: "m1", playerId: i, clubId: 1, jersey: i, positionLabel: "x", isStarter: true, minutes: 80, stats: { tries: 60 - i } },
      });
    }
  });
  afterAll(async () => {
    await (await appPromise).close();
    await db.$disconnect();
  });

  /** A legal finished mock: every team autopicks best available. */
  function fullMock(pool: MockPool, teamCount = 4) {
    const ranked = pool.players.map((p) => p.id);
    const positions = new Map(pool.players.map((p) => [p.id, p.positions]));
    const order = Array.from({ length: teamCount }, (_, i) => i);
    const rosters = order.map((): NrlPosition[][] => []);
    const taken = new Set<number>();
    const picks: number[] = [];
    for (let pickNo = 1; pickNo <= teamCount * squadSize(pool.roster); pickNo++) {
      const team = teamForPick(order, pickNo);
      const id = chooseAutopick({
        template: pool.roster, roster: rosters[team]!, queue: [], ranked,
        isAvailable: (x) => !taken.has(x), positionsOf: (x) => positions.get(x) ?? [],
      })!;
      taken.add(id);
      rosters[team]!.push(positions.get(id)!);
      picks.push(id);
    }
    return { teamCount, slot: 2, pickSeconds: 60, teamNames: order.map((i) => `Team ${i + 1}`), picks };
  }

  it("serves the pool ranked on the latest season under the site's scoring", async () => {
    const u = await createUser(db, "Me");
    const res = await call<MockPool>(u.id, "GET", "/api/mock/pool");
    expect(res.status).toBe(200);
    expect(res.body.season).toBe(2026);
    expect(res.body.players).toHaveLength(60);
    expect(res.body.players[0]).toMatchObject({ id: 1, rank: 1 }); // most tries
  });

  it("saves a finished mock, lists it, shows it, and deletes it, for its owner only", async () => {
    const me = await createUser(db, "Me");
    const other = await createUser(db, "Other");
    const pool = (await call<MockPool>(me.id, "GET", "/api/mock/pool")).body;
    const input = fullMock(pool);

    const saved = await call<MockDraftDetail>(me.id, "POST", "/api/mock-drafts", input);
    expect(saved.status).toBe(201);
    expect(saved.body.picks).toHaveLength(input.picks.length);
    expect(saved.body.picks[0]).toMatchObject({ pickNo: 1, playerId: input.picks[0], name: `P ${input.picks[0]}` });

    const list = await call<MockDraftSummary[]>(me.id, "GET", "/api/mock-drafts");
    expect(list.body).toHaveLength(1);
    // Slot 2 picks 2nd, then 7th (snake) in a 4-team draft.
    expect(list.body[0]!.firstPicks.slice(0, 2)).toEqual([`P ${input.picks[1]}`, `P ${input.picks[6]}`]);

    expect((await call(other.id, "GET", "/api/mock-drafts")).body).toEqual([]);
    expect((await call(other.id, "GET", `/api/mock-drafts/${saved.body.id}`)).status).toBe(404);
    expect((await call(other.id, "DELETE", `/api/mock-drafts/${saved.body.id}`)).status).toBe(404);

    expect((await call(me.id, "GET", `/api/mock-drafts/${saved.body.id}`)).body).toMatchObject({ teamCount: 4, slot: 2 });
    expect((await call(me.id, "DELETE", `/api/mock-drafts/${saved.body.id}`)).status).toBe(204);
    expect((await call(me.id, "GET", "/api/mock-drafts")).body).toEqual([]);
  });

  it("refuses mocks that break the draft rules", async () => {
    const me = await createUser(db, "Me");
    const pool = (await call<MockPool>(me.id, "GET", "/api/mock/pool")).body;
    const good = fullMock(pool);
    const post = (body: unknown) => call<{ error: string; message: string }>(me.id, "POST", "/api/mock-drafts", body);

    const unfinished = await post({ ...good, picks: good.picks.slice(1) });
    expect(unfinished.body, unfinished.body.message).toMatchObject({ error: "invalid_mock" });
    const twice = [...good.picks];
    twice[5] = twice[0]!;
    expect((await post({ ...good, picks: twice })).body.message).toMatch(/picked twice/);
    expect((await post({ ...good, picks: [999, ...good.picks.slice(1)] })).body.message).toMatch(/isn't in the player pool/);
    expect((await post({ ...good, slot: 5 })).body.message).toMatch(/outside the league/);
    expect((await post({ ...good, teamNames: ["A"] })).body.message).toMatch(/Every team needs a name/);

  });

  it("checks each pick fits what that team still needs", () => {
    // A one-player squad with a single forward spot: a half can't be anyone's only pick.
    const roster = { slots: [{ key: "FWD", label: "Forward", count: 1, eligible: ["FRF"] as NrlPosition[] }], benchSize: 0 };
    const player = (id: number, pos: NrlPosition): [number, DraftPlayer] =>
      [id, { id, name: `P ${id}`, club: null, positions: [pos], statsSeason: 2026, games: 1, avgPoints: 1, rank: id }];
    const players = new Map([player(1, "FRF"), player(2, "FRF"), player(3, "FRF"), player(4, "HB")]);
    const input = { teamCount: 4, slot: 1, pickSeconds: 0, teamNames: ["A", "B", "C", "D"] };
    expect(() => checkMock({ ...input, picks: [1, 2, 3, 4] }, roster, players)).toThrow(/Pick 4 \(P 4\): You need to fill a starting spot/);
  });
});
