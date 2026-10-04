import cors from "@fastify/cors";
import Fastify from "fastify";
import { DEFAULT_LEAGUE_SETTINGS } from "@nrl/shared";
import type { Env } from "./env.ts";

export async function buildApp(env: Env) {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : { level: "info" },
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN.split(",").map((o) => o.trim()),
    credentials: true,
  });

  // Also used to wake the free-tier host before a draft starts.
  app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

  app.get("/api/defaults/league-settings", async () => DEFAULT_LEAGUE_SETTINGS);

  return app;
}
