import {
  CreateLeagueInput,
  JoinLeagueInput,
  RenameTeamInput,
  UpdateLeagueInput,
  UpdateProfileInput,
  SCORING_STATS,
  leagueDefaults,
  type LeagueDefaults,
} from "@nrl/shared";
import type { PrismaClient } from "@nrl/db";
import type { FastifyInstance } from "fastify";
import type { Guards } from "../guards.ts";
import { getSiteConfig } from "../siteConfig.ts";
import { LeagueService } from "./service.ts";

export function registerLeagueRoutes(app: FastifyInstance, db: PrismaClient, { requireUser }: Guards) {
  const leagues = new LeagueService(db);

  type IdParams = { Params: { id: string } };
  type CodeParams = { Params: { code: string } };

  app.get("/api/me", async (req) => requireUser(req));

  // Defaults for a new league, and which settings the user may change.
  app.get("/api/league-defaults", async (req): Promise<LeagueDefaults> => {
    const user = await requireUser(req);
    const defaults = leagueDefaults(await getSiteConfig(db));
    // Site admins aren't limited.
    return user.isAdmin
      ? {
          ...defaults,
          commissionerCan: { scoring: true, roster: true, draftTimer: true, format: true },
          commissionerStats: [...SCORING_STATS],
        }
      : defaults;
  });

  app.patch("/api/me", async (req) => {
    const user = await requireUser(req);
    const { name } = UpdateProfileInput.parse(req.body);
    const updated = await db.user.update({ where: { id: user.id }, data: { name, updatedAt: new Date() } });
    return { ...user, name: updated.name };
  });

  app.get("/api/leagues", async (req) => leagues.listMine(await requireUser(req)));

  app.post("/api/leagues", async (req, reply) => {
    const user = await requireUser(req);
    const league = await leagues.create(user, CreateLeagueInput.parse(req.body));
    return reply.status(201).send(league);
  });

  app.get<IdParams>("/api/leagues/:id", async (req) => leagues.get(await requireUser(req), req.params.id));

  app.patch<IdParams>("/api/leagues/:id", async (req) =>
    leagues.update(await requireUser(req), req.params.id, UpdateLeagueInput.parse(req.body)),
  );

  app.post<IdParams>("/api/leagues/:id/invite/reset", async (req) =>
    leagues.regenerateInvite(await requireUser(req), req.params.id),
  );

  app.get<CodeParams>("/api/invites/:code", async (req) =>
    leagues.previewInvite(await requireUser(req), req.params.code),
  );

  app.post<CodeParams>("/api/invites/:code/join", async (req) => {
    const { teamName } = JoinLeagueInput.parse(req.body ?? {});
    return leagues.join(await requireUser(req), req.params.code, teamName);
  });

  app.patch<IdParams>("/api/teams/:id", async (req) => {
    const { name } = RenameTeamInput.parse(req.body);
    return leagues.renameTeam(await requireUser(req), req.params.id, name);
  });
}
