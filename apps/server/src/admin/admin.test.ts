import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminPlayer, Me } from "@nrl/shared";
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
});
