import cors from "@fastify/cors";
import Fastify from "fastify";
import { DEFAULT_LEAGUE_SETTINGS, type DraftState } from "@nrl/shared";
import type { PrismaClient } from "@nrl/db";
import { registerAdminRoutes } from "./admin/routes.ts";
import { registerAuthRoutes, sessionUserGetter, type Auth, type GetUser } from "./auth.ts";
import { DraftEngine, type DraftEngineOptions } from "./draft/engine.ts";
import { registerDraftRoutes } from "./draft/routes.ts";
import { attachDraftSockets } from "./draft/socket.ts";
import type { Env } from "./env.ts";
import { registerErrorHandler } from "./errors.ts";
import { createGuards, parseAdminEmails } from "./guards.ts";
import { registerLeagueRoutes } from "./leagues/routes.ts";
import type { LeagueServiceOptions } from "./leagues/service.ts";
import { registerSeasonRoutes } from "./season/routes.ts";
import { SeasonService } from "./season/service.ts";

export interface AppDeps {
  env: Env;
  db?: PrismaClient;
  auth?: Auth;
  /** Overrides how the signed-in user is found (tests use a header). */
  getUser?: GetUser;
  /** Draft engine options (tests inject a clock and timers). */
  draft?: Omit<DraftEngineOptions, "onChange" | "log">;
  /** League service options (tests inject a clock and shuffle). */
  leagues?: Omit<LeagueServiceOptions, "onDraftAtChange">;
  /** Season options (tests inject a clock). */
  season?: { now?: () => Date };
  /** Serve the draft room's sockets and run its clock (the real server). */
  realtime?: boolean;
}

export async function buildApp({ env, db, auth, getUser, draft, leagues, season, realtime = false }: AppDeps) {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : { level: "info" },
  });
  const origins = env.WEB_ORIGIN.split(",").map((o) => o.trim());

  await app.register(cors, { origin: origins, credentials: true });
  registerErrorHandler(app);

  // Also used to wake the free-tier host before a draft starts.
  app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

  app.get("/api/defaults/league-settings", async () => DEFAULT_LEAGUE_SETTINGS);

  if (auth) registerAuthRoutes(app, auth);
  const userGetter = getUser ?? (auth ? sessionUserGetter(auth) : null);
  if (db && userGetter) {
    const guards = createGuards(userGetter, parseAdminEmails(env.ADMIN_EMAILS));
    let broadcast: (state: DraftState) => void = () => {};
    const engine = new DraftEngine(db, { ...draft, onChange: (s) => broadcast(s), log: app.log });
    registerLeagueRoutes(app, db, guards, {
      ...(leagues ?? {}),
      onDraftAtChange: (leagueId, at) => engine.scheduleStart(leagueId, at),
    });
    registerAdminRoutes(app, db, guards);
    registerDraftRoutes(app, engine, guards);
    registerSeasonRoutes(app, new SeasonService(db, season ?? {}), guards);
    app.decorate("draftEngine", engine);

    if (realtime) {
      const sockets = attachDraftSockets(app.server, engine, guards, origins);
      broadcast = sockets.broadcast;
      app.addHook("onReady", async () => {
        const n = await engine.recover();
        if (n) app.log.info(`resumed the clock for ${n} live draft(s)`);
      });
      app.addHook("onClose", async () => {
        await sockets.io.close();
      });
    }
    app.addHook("onClose", async () => engine.shutdown());
  }

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    draftEngine?: DraftEngine;
  }
}
