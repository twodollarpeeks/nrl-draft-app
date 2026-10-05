import {
  CreateLeagueInput,
  JoinLeagueInput,
  RenameTeamInput,
  UpdateLeagueInput,
  UpdateProfileInput,
} from "@nrl/shared";
import type { PrismaClient } from "@nrl/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { GetUser, SessionUser } from "../auth.ts";
import { AppError } from "../errors.ts";
import { LeagueService } from "./service.ts";

export function registerLeagueRoutes(app: FastifyInstance, db: PrismaClient, getUser: GetUser) {
  const leagues = new LeagueService(db);

  async function requireUser(req: FastifyRequest): Promise<SessionUser> {
    const user = await getUser(req);
    if (!user) throw new AppError(401, "unauthenticated", "Please sign in");
    return user;
  }

  type IdParams = { Params: { id: string } };
  type CodeParams = { Params: { code: string } };

  app.get("/api/me", async (req) => requireUser(req));

  app.patch("/api/me", async (req) => {
    const user = await requireUser(req);
    const { name } = UpdateProfileInput.parse(req.body);
    const updated = await db.user.update({ where: { id: user.id }, data: { name, updatedAt: new Date() } });
    return { id: updated.id, name: updated.name, email: updated.email, image: updated.image };
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
