import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_CONFIG,
  type AdminPlayer,
  type LeagueDefaults,
  type LeagueDetail,
  type Me,
  type ScoringPreview,
  type SiteConfig,
} from "@nrl/shared";
import { createUser, hasTestDb, resetDb, testDb } from "../../../../test/db.ts";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { parseAdminEmails } from "../guards.ts";

describe("parseAdminEmails", () => {
  it("splits, trims and lower-cases", () => {
    expect([...parseAdminEmails(" A@x.com, b@Y.com ,,")]).toEqual(["a@x.com", "b@y.com"]);
    expect(parseAdminEmails(undefined).size).toBe(0);
  });
});

describe.runIf(hasTestDb)("admin player positions", () => {
  const db = testDb();
  let admin: { id: string };
  let member: { id: string };

  const appPromise = (async () => {
    return buildApp({
      env: loadEnv({ NODE_ENV: "test", ADMIN_EMAILS: "Boss@Example.test" }),
      db,
      getUser: async (req) => {
        const id = req.headers["x-test-user"];
        const u = typeof id === "string" ? await db.user.findUnique({ where: { id } }) : null;
        return u && { id: u.id, name: u.name, email: u.email, image: u.image };
      },
    });
  })();

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
    const a = await createUser(db, "The Boss");
    admin = await db.user.update({ where: { id: a.id }, data: { email: "boss@example.test" } });
    member = await createUser(db, "Regular Joe");
    await db.club.create({ data: { id: 1, key: "storm", nickName: "Storm" } });
    await db.player.createMany({
      data: [
        { id: 10, firstName: "Josh", lastName: "Kerr", clubId: 1, positions: [], positionsOverride: [] },
        { id: 11, firstName: "Billy", lastName: "Phillips", clubId: 1, positions: [], positionsOverride: [] },
        { id: 12, firstName: "Cameron", lastName: "Munster", clubId: 1, positions: ["FE"], positionsOverride: [] },
      ],
    });
  });
  afterAll(async () => {
    await (await appPromise).close();
    await db.$disconnect();
  });

  it("tells the client who is an admin (case-insensitive email match)", async () => {
    expect((await call<Me>(admin.id, "GET", "/api/me")).body.isAdmin).toBe(true);
    expect((await call<Me>(member.id, "GET", "/api/me")).body.isAdmin).toBe(false);
  });

  it("keeps non-admins out", async () => {
    expect((await call(member.id, "GET", "/api/admin/players")).status).toBe(403);
    expect((await call(member.id, "PATCH", "/api/admin/players/10", { positionsOverride: ["FRF"] })).status).toBe(403);
  });

  it("lists players missing a position by default", async () => {
    const res = await call<AdminPlayer[]>(admin.id, "GET", "/api/admin/players");
    expect(res.body.map((p) => p.name).sort()).toEqual(["Billy Phillips", "Josh Kerr"]);
  });

  it("searches by name across first and last name", async () => {
    const res = await call<AdminPlayer[]>(admin.id, "GET", "/api/admin/players?filter=all&q=cam%20muns");
    expect(res.body.map((p) => p.name)).toEqual(["Cameron Munster"]);
  });

  it("sets an override that wins over derived positions, and clears it", async () => {
    const set = await call<AdminPlayer>(admin.id, "PATCH", "/api/admin/players/12", { positionsOverride: ["FE", "HB"] });
    expect(set.body).toMatchObject({ positions: ["FE", "HB"], derivedPositions: ["FE"], positionsOverride: ["FE", "HB"] });

    const overridden = await call<AdminPlayer[]>(admin.id, "GET", "/api/admin/players?filter=overridden");
    expect(overridden.body.map((p) => p.id)).toEqual([12]);

    const cleared = await call<AdminPlayer>(admin.id, "PATCH", "/api/admin/players/12", { positionsOverride: [] });
    expect(cleared.body.positions).toEqual(["FE"]);
  });

  it("a player given a position drops off the missing list", async () => {
    await call(admin.id, "PATCH", "/api/admin/players/10", { positionsOverride: ["FRF"] });
    const res = await call<AdminPlayer[]>(admin.id, "GET", "/api/admin/players");
    expect(res.body.map((p) => p.name)).toEqual(["Billy Phillips"]);
  });

  it("rejects unknown positions and unknown players", async () => {
    expect((await call(admin.id, "PATCH", "/api/admin/players/10", { positionsOverride: ["QB"] })).status).toBe(400);
    expect((await call(admin.id, "PATCH", "/api/admin/players/999", { positionsOverride: ["FB"] })).status).toBe(404);
  });

  describe("site config", () => {
    const locked: SiteConfig = {
      defaultScoring: { tries: 10, tackles: 0.5, lineBreaks: 2 },
      commissionerCan: { scoring: true, roster: false, draftTimer: true, format: false },
      commissionerStats: ["tries"],
    };

    it("starts at the built-in defaults, and only admins can read or change it", async () => {
      expect((await call(admin.id, "GET", "/api/admin/site-config")).body).toEqual(DEFAULT_SITE_CONFIG);
      expect((await call(member.id, "GET", "/api/admin/site-config")).status).toBe(403);
      expect((await call(member.id, "PUT", "/api/admin/site-config", locked)).status).toBe(403);
    });

    it("saves a config and rejects unknown stats", async () => {
      expect((await call(admin.id, "PUT", "/api/admin/site-config", locked)).status).toBe(200);
      expect((await call(admin.id, "GET", "/api/admin/site-config")).body).toEqual(locked);
      const bad = { ...locked, defaultScoring: { notAStat: 1 } };
      expect((await call(admin.id, "PUT", "/api/admin/site-config", bad)).status).toBe(400);
    });

    it("gives new leagues the admin's default scoring and tells members what they can change", async () => {
      await call(admin.id, "PUT", "/api/admin/site-config", locked);
      const res = await call<LeagueDefaults>(member.id, "GET", "/api/league-defaults");
      expect(res.body.settings.scoring).toEqual(locked.defaultScoring);
      expect(res.body.commissionerCan).toEqual(locked.commissionerCan);
      expect(res.body.commissionerStats).toEqual(["tries"]);
      // Admins see everything unlocked.
      const mine = await call<LeagueDefaults>(admin.id, "GET", "/api/league-defaults");
      expect(mine.body.commissionerCan).toEqual({ scoring: true, roster: true, draftTimer: true, format: true });
    });

    it("enforces the limits when a commissioner creates and edits a league", async () => {
      await call(admin.id, "PUT", "/api/admin/site-config", locked);
      const defaults = (await call<LeagueDefaults>(member.id, "GET", "/api/league-defaults")).body.settings;
      const wanted = {
        ...defaults,
        teamCount: 6,
        scoring: { tries: 4, tackles: 2, sinBins: -10 }, // only tries is theirs to change
        roster: { ...defaults.roster, benchSize: 2 }, // not allowed
        draft: { type: "snake", pickSeconds: 90 }, // allowed
        matchups: { mode: "totalPoints" }, // not allowed
      };
      const created = await call<LeagueDetail>(member.id, "POST", "/api/leagues", { name: "Limited", season: 2027, settings: wanted });
      expect(created.status).toBe(201);
      expect(created.body.settings).toEqual({
        ...defaults,
        teamCount: 6,
        scoring: { tries: 4, tackles: 0.5, lineBreaks: 2 },
        draft: { type: "snake", pickSeconds: 90 },
      });

      // Editing later: locked stats stay as the league has them.
      const edited = await call<LeagueDetail>(member.id, "PATCH", `/api/leagues/${created.body.id}`, {
        settings: { ...created.body.settings, scoring: { tries: 12, lineBreaks: 9 } },
      });
      expect(edited.body.settings.scoring).toEqual({ tries: 12, tackles: 0.5, lineBreaks: 2 });
    });

    it("doesn't limit site admins", async () => {
      await call(admin.id, "PUT", "/api/admin/site-config", locked);
      const defaults = (await call<LeagueDefaults>(admin.id, "GET", "/api/league-defaults")).body.settings;
      const created = await call<LeagueDetail>(admin.id, "POST", "/api/leagues", {
        name: "Boss League", season: 2027, settings: { ...defaults, scoring: { tackles: 3 } },
      });
      expect(created.body.settings.scoring).toEqual({ tackles: 3 });
    });

    it("previews how even a scoring is across positions", async () => {
      // Two regulars per group with 10 games: forwards tackle, backs score tries.
      const round = await db.round.create({ data: { season: 2026, number: 1, title: "R1", slug: "round-1", byeClubKeys: [] } });
      const setup: Array<[number, string, Record<string, number>]> = [
        [20, "FRF", { tacklesMade: 40, allRunMetres: 120 }],
        [21, "LK", { tacklesMade: 30, allRunMetres: 100 }],
        [22, "WG", { tries: 1, allRunMetres: 150 }],
        [23, "FB", { tries: 1, allRunMetres: 160, tryAssists: 1 }],
        [24, "HB", { tryAssists: 1, conversions: 3, allRunMetres: 50 }],
        [25, "HK", { tacklesMade: 45, allRunMetres: 40 }],
      ];
      for (const [id, pos] of setup) {
        await db.player.create({ data: { id, firstName: "P", lastName: String(id), positions: [pos], positionsOverride: [] } });
      }
      for (let g = 0; g < 10; g++) {
        const match = await db.match.create({
          data: { id: `pm${g}`, roundId: round.id, homeClubId: 1, awayClubId: 1, kickoffAt: new Date(), url: `/pm${g}`, state: "FullTime" },
        });
        for (const [id, , stats] of setup) {
          await db.appearance.create({
            data: { matchId: match.id, playerId: id, clubId: 1, jersey: id, positionLabel: "x", isStarter: true, minutes: 80, stats },
          });
        }
      }
      const res = await call<ScoringPreview>(admin.id, "POST", "/api/admin/scoring/preview", {
        scoring: { tackles: 1, tries: 8 },
      });
      expect(res.body.season).toBe(2026);
      const level = Object.fromEntries(res.body.groups.map((g) => [g.group, g.starterLevel]));
      // Last of 2 forwards: 30 tackles; last of 2 backs: 8; last half/hooker: HB's 0.
      expect(level).toEqual({ FWD: 30, OB: 8, HBHK: 0 });
      expect(res.body.groups.find((g) => g.group === "HBHK")!.best).toEqual({ name: "P 25", avgPoints: 45 });
      expect(res.body.top[0]).toMatchObject({ name: "P 25", avgPoints: 45, games: 10 });
      expect((await call(member.id, "POST", "/api/admin/scoring/preview", { scoring: {} })).status).toBe(403);
    }, 60_000);
  });
});
