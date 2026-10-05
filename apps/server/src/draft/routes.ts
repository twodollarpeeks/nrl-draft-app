import { MakePickInput, SetAutopilotInput, SetQueueInput } from "@nrl/shared";
import type { FastifyInstance } from "fastify";
import type { Guards } from "../guards.ts";
import type { DraftEngine } from "./engine.ts";

// Every change goes through plain HTTP (easy to retry, easy to test); the
// socket only pushes the resulting state to everyone in the room.
export function registerDraftRoutes(app: FastifyInstance, engine: DraftEngine, { requireUser }: Guards) {
  type P = { Params: { id: string } };
  const base = "/api/leagues/:id/draft";

  app.get<P>(base, async (req) => engine.state(await requireUser(req), req.params.id));
  app.get<P>(`${base}/players`, async (req) => engine.players(await requireUser(req), req.params.id));
  app.get<P>(`${base}/queue`, async (req) => engine.queue(await requireUser(req), req.params.id));

  app.put<P>(`${base}/queue`, async (req) => {
    const { playerIds } = SetQueueInput.parse(req.body);
    return engine.setQueue(await requireUser(req), req.params.id, playerIds);
  });

  app.post<P>(`${base}/pick`, async (req) =>
    engine.pick(await requireUser(req), req.params.id, MakePickInput.parse(req.body)),
  );

  app.post<P>(`${base}/autopilot`, async (req) => {
    const { on } = SetAutopilotInput.parse(req.body);
    return engine.setAutopilot(await requireUser(req), req.params.id, on);
  });

  app.post<P>(`${base}/start`, async (req) => engine.start(await requireUser(req), req.params.id));
  app.post<P>(`${base}/pause`, async (req) => engine.pause(await requireUser(req), req.params.id));
  app.post<P>(`${base}/resume`, async (req) => engine.resume(await requireUser(req), req.params.id));
  app.post<P>(`${base}/undo`, async (req) => engine.undo(await requireUser(req), req.params.id));
}
