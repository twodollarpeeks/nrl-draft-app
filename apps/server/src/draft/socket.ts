import type { Server as HttpServer } from "node:http";
import { DRAFT_EVENTS, type DraftState } from "@nrl/shared";
import { Server } from "socket.io";
import { AppError } from "../errors.ts";
import type { Guards } from "../guards.ts";
import type { DraftEngine } from "./engine.ts";

export const roomFor = (leagueId: string) => `draft:${leagueId}`;

/**
 * Draft room sockets. A client connects (its session cookie comes with the
 * handshake), joins a league's room, and gets the full state straight away
 * and again after every change. Reconnecting just means joining again, so a
 * refresh, a dropped connection or a late arrival always sees current state.
 */
export function attachDraftSockets(server: HttpServer, engine: DraftEngine, guards: Guards, origins: string[]) {
  const io = new Server(server, {
    path: "/socket.io",
    cors: { origin: origins, credentials: true },
    // Detect dead connections quickly on phones.
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  io.use(async (socket, next) => {
    try {
      socket.data.user = await guards.requireUser(socket.request);
      next();
    } catch {
      next(new Error("unauthenticated"));
    }
  });

  io.on("connection", (socket) => {
    socket.on(DRAFT_EVENTS.join, async (payload: { leagueId?: unknown }) => {
      const leagueId = typeof payload?.leagueId === "string" ? payload.leagueId : "";
      try {
        const state = await engine.state(socket.data.user, leagueId);
        for (const room of socket.rooms) if (room.startsWith("draft:")) await socket.leave(room);
        await socket.join(roomFor(leagueId));
        socket.emit(DRAFT_EVENTS.state, state);
      } catch (err) {
        const notMember = err instanceof AppError && err.status === 404;
        socket.emit(DRAFT_EVENTS.error, {
          message: notMember ? "You're not in this league" : "Couldn't load the draft. Retrying…",
          retry: !notMember,
        });
      }
    });
  });

  return {
    io,
    broadcast(state: DraftState) {
      io.to(roomFor(state.leagueId)).emit(DRAFT_EVENTS.state, state);
    },
  };
}
