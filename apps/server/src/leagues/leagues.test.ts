import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE_SETTINGS, type LeagueDetail } from "@nrl/shared";
import { createUser, hasTestDb, resetDb, testDb } from "../../../../test/db.ts";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { defaultTeamName, newInviteCode, uniqueName } from "./service.ts";

describe("helpers", () => {
  it("invite codes avoid look-alike characters", () => {
    for (let i = 0; i < 50; i++) expect(newInviteCode()).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });
  it("default team names use the first name", () => {
    expect(defaultTeamName("Nathan Cleary")).toBe("Nathan's Team");
  });
  it("unique names add a number when taken", () => {
    expect(uniqueName("Sam's Team", ["sam's team", "Sam's Team 2"])).toBe("Sam's Team 3");
    expect(uniqueName("New", ["Old"])).toBe("New");
  });
});

describe.runIf(hasTestDb)("league API", () => {
  const db = testDb();
  const settings = DEFAULT_LEAGUE_SETTINGS;

  // Tests sign in by sending the user's id in a header.
  const appPromise = buildApp({
    env: loadEnv({ NODE_ENV: "test" }),
    db,
    getUser: async (req) => {
      const id = req.headers["x-test-user"];
      if (typeof id !== "string") return null;
      const u = await db.user.findUnique({ where: { id } });
      return u && { id: u.id, name: u.name, email: u.email, image: u.image };
    },
  });

  async function call<T = unknown>(userId: string | null, method: string, url: string, body?: unknown) {
    const app = await appPromise;
    const res = await app.inject({
      method: method as "GET",
      url,
      headers: userId ? { "x-test-user": userId } : {},
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    return { status: res.statusCode, body: res.json() as T };
  }

  beforeEach(() => resetDb(db));
  afterAll(async () => {
    await (await appPromise).close();
    await db.$disconnect();
  });

  async function newLeague(teamCount = 4) {
    const owner = await createUser(db, "Alice Smith");
    const res = await call<LeagueDetail>(owner.id, "POST", "/api/leagues", {
      name: "The Boys",
      season: 2027,
      settings: { ...settings, teamCount },
    });
    expect(res.status).toBe(201);
    return { owner, league: res.body };
  }

  it("requires sign-in", async () => {
    expect((await call(null, "GET", "/api/leagues")).status).toBe(401);
  });

  it("creates a league with the creator as commissioner and first team", async () => {
    const { owner, league } = await newLeague();
    expect(league).toMatchObject({
      name: "The Boys", season: 2027, status: "setup", isCommissioner: true, teamsJoined: 1, teamCount: 4,
    });
    expect(league.teams).toEqual([
      expect.objectContaining({ name: "Alice's Team", isCommissioner: true, owner: expect.objectContaining({ id: owner.id }) }),
    ]);
    expect(league.inviteCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(await db.auditLog.count({ where: { leagueId: league.id, action: "league.create" } })).toBe(1);
  });

  it("rejects invalid settings", async () => {
    const u = await createUser(db);
    const res = await call(u.id, "POST", "/api/leagues", { name: "X League", season: 2027, settings: { ...settings, teamCount: 20 } });
    expect(res.status).toBe(400);
  });

  it("lets friends preview and join with the invite code", async () => {
    const { league } = await newLeague();
    const bob = await createUser(db, "Bob Jones");

    const preview = await call(bob.id, "GET", `/api/invites/${league.inviteCode.toLowerCase()}`);
    expect(preview.body).toMatchObject({ name: "The Boys", commissionerName: "Alice Smith", canJoin: true, teamsJoined: 1 });

    const joined = await call<LeagueDetail>(bob.id, "POST", `/api/invites/${league.inviteCode}/join`, { teamName: "Bob's Bulldozers" });
    expect(joined.status).toBe(200);
    expect(joined.body.teams.map((t) => t.name)).toEqual(["Alice's Team", "Bob's Bulldozers"]);
    expect(joined.body.isCommissioner).toBe(false);

    const again = await call(bob.id, "POST", `/api/invites/${league.inviteCode}/join`, {});
    expect(again).toMatchObject({ status: 409, body: { error: "already_member" } });
  });

  it("refuses to join a full league", async () => {
    const { league } = await newLeague(4);
    for (let i = 0; i < 3; i++) {
      const u = await createUser(db, `Friend ${i}`);
      expect((await call(u.id, "POST", `/api/invites/${league.inviteCode}/join`, {})).status).toBe(200);
    }
    const late = await createUser(db, "Late Larry");
    expect((await call(late.id, "GET", `/api/invites/${league.inviteCode}`)).body).toMatchObject({ canJoin: false, reason: "full" });
    expect(await call(late.id, "POST", `/api/invites/${league.inviteCode}/join`, {})).toMatchObject({
      status: 409, body: { error: "league_full" },
    });
  });

  it("never overfills when people join at the same time", async () => {
    const { league } = await newLeague(4);
    const users = await Promise.all(Array.from({ length: 6 }, (_, i) => createUser(db, `Racer ${i}`)));
    const results = await Promise.all(users.map((u) => call(u.id, "POST", `/api/invites/${league.inviteCode}/join`, {})));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(await db.team.count({ where: { leagueId: league.id } })).toBe(4);
  }, 60_000);

  it("gives duplicate default team names a number, but rejects a duplicate chosen name", async () => {
    const { league } = await newLeague();
    const alice2 = await createUser(db, "Alice Brown");
    const joined = await call<LeagueDetail>(alice2.id, "POST", `/api/invites/${league.inviteCode}/join`, {});
    expect(joined.body.teams.map((t) => t.name)).toContain("Alice's Team 2");

    const carl = await createUser(db, "Carl");
    expect(await call(carl.id, "POST", `/api/invites/${league.inviteCode}/join`, { teamName: "alice's team" })).toMatchObject({
      status: 409, body: { error: "team_name_taken" },
    });
  });

  it("hides leagues from non-members", async () => {
    const { league } = await newLeague();
    const stranger = await createUser(db);
    expect((await call(stranger.id, "GET", `/api/leagues/${league.id}`)).status).toBe(404);
    expect((await call(stranger.id, "GET", "/api/leagues")).body).toEqual([]);
  });

  it("only the commissioner can change settings", async () => {
    const { owner, league } = await newLeague();
    const bob = await createUser(db, "Bob");
    await call(bob.id, "POST", `/api/invites/${league.inviteCode}/join`, {});

    const newSettings = { ...settings, teamCount: 6, draft: { type: "snake", pickSeconds: 90 } };
    expect((await call(bob.id, "PATCH", `/api/leagues/${league.id}`, { settings: newSettings })).status).toBe(403);

    const res = await call<LeagueDetail>(owner.id, "PATCH", `/api/leagues/${league.id}`, { settings: newSettings, name: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Renamed", teamCount: 6 });
    expect(res.body.settings.draft.pickSeconds).toBe(90);
  });

  it("won't shrink the league below the teams already joined", async () => {
    const { owner, league } = await newLeague(6);
    for (let i = 0; i < 4; i++) {
      const u = await createUser(db, `F${i}`);
      await call(u.id, "POST", `/api/invites/${league.inviteCode}/join`, {});
    }
    const res = await call(owner.id, "PATCH", `/api/leagues/${league.id}`, { settings: { ...settings, teamCount: 4 } });
    expect(res).toMatchObject({ status: 409, body: { error: "too_many_teams" } });
  });

  it("locks settings once the league has left setup", async () => {
    const { owner, league } = await newLeague();
    await db.league.update({ where: { id: league.id }, data: { status: "drafting" } });
    const res = await call(owner.id, "PATCH", `/api/leagues/${league.id}`, { settings });
    expect(res).toMatchObject({ status: 409, body: { error: "league_started" } });
  });

  it("resetting the invite invalidates the old code", async () => {
    const { owner, league } = await newLeague();
    const reset = await call<LeagueDetail>(owner.id, "POST", `/api/leagues/${league.id}/invite/reset`);
    expect(reset.body.inviteCode).not.toBe(league.inviteCode);
    const bob = await createUser(db);
    expect((await call(bob.id, "GET", `/api/invites/${league.inviteCode}`)).status).toBe(404);
  });

  it("lets owners rename their own team only", async () => {
    const { owner, league } = await newLeague();
    const bob = await createUser(db, "Bob");
    const joined = await call<LeagueDetail>(bob.id, "POST", `/api/invites/${league.inviteCode}/join`, {});
    const bobTeam = joined.body.teams.find((t) => t.owner.id === bob.id)!;

    expect((await call(owner.id, "PATCH", `/api/teams/${bobTeam.id}`, { name: "Hacked" })).status).toBe(403);
    const ok = await call<LeagueDetail>(bob.id, "PATCH", `/api/teams/${bobTeam.id}`, { name: "Bob's Best" });
    expect(ok.body.teams.find((t) => t.id === bobTeam.id)!.name).toBe("Bob's Best");
    expect(await call(bob.id, "PATCH", `/api/teams/${bobTeam.id}`, { name: "Alice's Team" })).toMatchObject({
      status: 409, body: { error: "team_name_taken" },
    });
  });
});
