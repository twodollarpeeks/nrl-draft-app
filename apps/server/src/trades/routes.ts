import { ProposeTradeInput, TradeVoteInput } from "@nrl/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Guards } from "../guards.ts";
import type { TradeService } from "./service.ts";

const VetoInput = z.object({ note: z.string().trim().max(200).optional() });

export function registerTradeRoutes(app: FastifyInstance, trades: TradeService, { requireUser }: Guards) {
  type P = { Params: { id: string; tradeId: string } };
  const done = (reply: { status: (n: number) => { send: () => unknown } }) => reply.status(204).send();

  app.get<P>("/api/leagues/:id/trades", async (req) => trades.list(await requireUser(req), req.params.id));

  app.post<P>("/api/leagues/:id/trades", async (req, reply) => {
    await trades.propose(await requireUser(req), req.params.id, ProposeTradeInput.parse(req.body));
    return done(reply);
  });

  for (const action of ["accept", "reject", "cancel"] as const) {
    app.post<P>(`/api/leagues/:id/trades/:tradeId/${action}`, async (req, reply) => {
      await trades.respond(await requireUser(req), req.params.id, req.params.tradeId, action);
      return done(reply);
    });
  }

  app.post<P>("/api/leagues/:id/trades/:tradeId/vote", async (req, reply) => {
    await trades.vote(await requireUser(req), req.params.id, req.params.tradeId, TradeVoteInput.parse(req.body).approve);
    return done(reply);
  });

  app.post<P>("/api/leagues/:id/trades/:tradeId/approve", async (req, reply) => {
    await trades.decide(await requireUser(req), req.params.id, req.params.tradeId, true);
    return done(reply);
  });

  app.post<P>("/api/leagues/:id/trades/:tradeId/veto", async (req, reply) => {
    await trades.decide(await requireUser(req), req.params.id, req.params.tradeId, false, VetoInput.parse(req.body ?? {}).note);
    return done(reply);
  });
}
