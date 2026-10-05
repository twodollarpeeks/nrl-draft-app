import cors from "@fastify/cors";
import Fastify from "fastify";
import { DEFAULT_LEAGUE_SETTINGS } from "@nrl/shared";
import type { PrismaClient } from "@nrl/db";
import { registerAuthRoutes, sessionUserGetter, type Auth, type GetUser } from "./auth.ts";
import type { Env } from "./env.ts";
import { registerErrorHandler } from "./errors.ts";
import { registerLeagueRoutes } from "./leagues/routes.ts";

export interface AppDeps {
  env: Env;
  db?: PrismaClient;
  auth?: Auth;
  /** Overrides how the signed-in user is found (tests use a header). */
  getUser?: GetUser;
}

export async function buildApp({ env, db, auth, getUser }: AppDeps) {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : { level: "info" },
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN.split(",").map((o) => o.trim()),
    credentials: true,
  });
  registerErrorHandler(app);

  // Also used to wake the free-tier host before a draft starts.
  app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

  app.get("/api/defaults/league-settings", async () => DEFAULT_LEAGUE_SETTINGS);

  if (auth) registerAuthRoutes(app, auth);
  const userGetter = getUser ?? (auth ? sessionUserGetter(auth) : null);
  if (db && userGetter) registerLeagueRoutes(app, db, userGetter);

  return app;
}
