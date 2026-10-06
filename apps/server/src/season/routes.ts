import { LineupInput } from "@nrl/shared";
import type { FastifyInstance } from "fastify";
import type { Guards } from "../guards.ts";
import type { SeasonService } from "./service.ts";

export function registerSeasonRoutes(app: FastifyInstance, season: SeasonService, { requireUser }: Guards) {
  type P = { Params: { id: string; round: string; teamId: string } };

  app.get<P>("/api/leagues/:id/season", async (req) => season.overview(await requireUser(req), req.params.id));

  app.get<P>("/api/leagues/:id/rounds/:round", async (req) =>
    season.round(await requireUser(req), req.params.id, Number(req.params.round)),
  );

  app.get<P>("/api/leagues/:id/teams/:teamId/rounds/:round", async (req) =>
    season.teamRound(await requireUser(req), req.params.id, req.params.teamId, Number(req.params.round)),
  );

  app.put<P>("/api/leagues/:id/teams/:teamId/rounds/:round/lineup", async (req) =>
    season.saveLineup(
      await requireUser(req),
      req.params.id,
      req.params.teamId,
      Number(req.params.round),
      LineupInput.parse(req.body),
    ),
  );
}
