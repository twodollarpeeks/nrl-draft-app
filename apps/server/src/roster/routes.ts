import { AddPlayerInput, ClaimOrderInput, DropPlayerInput } from "@nrl/shared";
import type { FastifyInstance } from "fastify";
import type { Guards } from "../guards.ts";
import type { RosterService } from "./service.ts";

export function registerRosterRoutes(app: FastifyInstance, roster: RosterService, { requireUser }: Guards) {
  type P = { Params: { id: string; claimId: string } };

  app.get<P>("/api/leagues/:id/players", async (req) => roster.players(await requireUser(req), req.params.id));
  app.get<{ Params: { id: string; playerId: string } }>("/api/leagues/:id/players/:playerId/season", async (req) =>
    roster.playerSeason(await requireUser(req), req.params.id, Number(req.params.playerId)),
  );
  app.get<P>("/api/leagues/:id/activity", async (req) => roster.activity(await requireUser(req), req.params.id));

  app.post<P>("/api/leagues/:id/roster/add", async (req, reply) => {
    await roster.add(await requireUser(req), req.params.id, AddPlayerInput.parse(req.body));
    return reply.status(204).send();
  });

  app.post<P>("/api/leagues/:id/roster/drop", async (req, reply) => {
    const { teamId, playerId } = DropPlayerInput.parse(req.body);
    await roster.drop(await requireUser(req), req.params.id, teamId, playerId);
    return reply.status(204).send();
  });

  app.post<P>("/api/leagues/:id/waivers/claims", async (req, reply) => {
    await roster.claim(await requireUser(req), req.params.id, AddPlayerInput.parse(req.body));
    return reply.status(204).send();
  });

  app.delete<P>("/api/leagues/:id/waivers/claims/:claimId", async (req, reply) => {
    await roster.cancelClaim(await requireUser(req), req.params.id, req.params.claimId);
    return reply.status(204).send();
  });

  app.put<P>("/api/leagues/:id/waivers/claims", async (req, reply) => {
    const { teamId, claimIds } = ClaimOrderInput.parse(req.body);
    await roster.orderClaims(await requireUser(req), req.params.id, teamId, claimIds);
    return reply.status(204).send();
  });
}
