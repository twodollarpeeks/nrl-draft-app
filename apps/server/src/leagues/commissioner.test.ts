import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE_SETTINGS, type HandoverPreview, type LeagueDetail } from "@nrl/shared";
import { createUser, hasTestDb, resetDb, testDb } from "../../../../test/db.ts";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";

describe.runIf(hasTestDb)("commissioner tools", () => {
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

  let owner: { id: string };
  let mate: { id: string };
  let league: LeagueDetail;
  const mateTeam = () => league.teams.find((t) => t.owner.id === mate.id)!.id;

  beforeEach(async () => {
    await resetDb(db);
    owner = await createUser(db, "Owner");
    mate = await createUser(db, "Mate");
    const created = await call<LeagueDetail>(owner.id, "POST", "/api/leagues", {
      name: "Commish Test", season: 2027, settings: { ...DEFAULT_LEAGUE_SETTINGS, teamCount: 4 },
    });
    league = (await call<LeagueDetail>(mate.id, "POST", `/api/invites/${created.body.inviteCode}/join`, {})).body;
  });
  afterAll(async () => {
    await (await appPromise).close();
    await db.$disconnect();
  });

  it("hands a team to whoever opens the link; only the commissioner can make one", async () => {
    expect((await call(mate.id, "POST", `/api/leagues/${league.id}/handover`, { teamId: mateTeam() })).status).toBe(403);
    const own = league.teams.find((t) => t.owner.id === owner.id)!.id;
    expect((await call(owner.id, "POST", `/api/leagues/${league.id}/handover`, { teamId: own })).body).toMatchObject({ error: "own_team" });

    const made = await call<LeagueDetail>(owner.id, "POST", `/api/leagues/${league.id}/handover`, { teamId: mateTeam() });
    const code = made.body.teams.find((t) => t.id === mateTeam())!.handoverCode!;
    expect(code).toMatch(/^[A-Z0-9]{10}$/);
    // Only the commissioner sees the link.
    const seenByMate = (await call<LeagueDetail>(mate.id, "GET", `/api/leagues/${league.id}`)).body;
    expect(seenByMate.teams.every((t) => t.handoverCode === undefined)).toBe(true);

    // Someone already in the league can't take it.
    expect((await call<HandoverPreview>(owner.id, "GET", `/api/handover/${code}`)).body.alreadyMember).toBe(true);
    expect((await call(owner.id, "POST", `/api/handover/${code}/accept`)).body).toMatchObject({ error: "already_member" });

    const newcomer = await createUser(db, "Newcomer");
    expect((await call<HandoverPreview>(newcomer.id, "GET", `/api/handover/${code}`)).body).toMatchObject({
      leagueName: "Commish Test", currentManager: "Mate", alreadyMember: false,
    });
    const joined = await call<LeagueDetail>(newcomer.id, "POST", `/api/handover/${code}/accept`);
    expect(joined.status).toBe(200);
    expect(joined.body.myTeamId).toBe(mateTeam());
    // The old manager is out, and the link is spent.
    expect((await call(mate.id, "GET", `/api/leagues/${league.id}`)).status).toBe(404);
    expect((await call(newcomer.id, "GET", `/api/handover/${code}`)).status).toBe(404);
  });

  it("can take a link back", async () => {
    const made = await call<LeagueDetail>(owner.id, "POST", `/api/leagues/${league.id}/handover`, { teamId: mateTeam() });
    const code = made.body.teams.find((t) => t.id === mateTeam())!.handoverCode!;
    await call(owner.id, "DELETE", `/api/leagues/${league.id}/handover/${mateTeam()}`);
    const newcomer = await createUser(db, "Newcomer");
    expect((await call(newcomer.id, "POST", `/api/handover/${code}/accept`)).status).toBe(404);
  });

  it("passes the commissioner role on", async () => {
    expect((await call(mate.id, "POST", `/api/leagues/${league.id}/commissioner`, { teamId: mateTeam() })).status).toBe(403);
    const after = await call<LeagueDetail>(owner.id, "POST", `/api/leagues/${league.id}/commissioner`, { teamId: mateTeam() });
    expect(after.body.isCommissioner).toBe(false);
    expect(after.body.teams.find((t) => t.id === mateTeam())!.isCommissioner).toBe(true);
    expect((await call<LeagueDetail>(mate.id, "GET", `/api/leagues/${league.id}`)).body.isCommissioner).toBe(true);
    expect((await call(owner.id, "POST", `/api/leagues/${league.id}/invite/reset`)).status).toBe(403);
  });
});
