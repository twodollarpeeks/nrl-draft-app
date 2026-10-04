import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadEnv } from "./env.ts";

describe("server", () => {
  it("responds to /health", async () => {
    const app = await buildApp(loadEnv({ NODE_ENV: "test" }));
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  it("serves default league settings", async () => {
    const app = await buildApp(loadEnv({ NODE_ENV: "test" }));
    const res = await app.inject({ method: "GET", url: "/api/defaults/league-settings" });
    expect(res.json().teamCount).toBe(8);
    await app.close();
  });
});
