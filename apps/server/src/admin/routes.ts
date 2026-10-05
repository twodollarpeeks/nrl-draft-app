import type { Prisma, PrismaClient } from "@nrl/db";
import {
  PlayerFilter,
  UpdatePlayerPositionsInput,
  effectivePositions,
  type AdminPlayer,
  type NrlPosition,
} from "@nrl/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notFound } from "../errors.ts";
import type { Guards } from "../guards.ts";

const ListQuery = z.object({
  filter: PlayerFilter.default("missing"),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const playerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  positions: true,
  positionsOverride: true,
  club: { select: { key: true, nickName: true } },
  _count: { select: { appearances: true } },
} satisfies Prisma.PlayerSelect;

function toAdminPlayer(p: Prisma.PlayerGetPayload<{ select: typeof playerSelect }>): AdminPlayer {
  return {
    id: p.id,
    name: `${p.firstName} ${p.lastName}`,
    club: p.club,
    appearances: p._count.appearances,
    positions: effectivePositions(p),
    derivedPositions: p.positions as NrlPosition[],
    positionsOverride: p.positionsOverride as NrlPosition[],
  };
}

export function registerAdminRoutes(app: FastifyInstance, db: PrismaClient, { requireAdmin }: Guards) {
  app.get("/api/admin/players", async (req) => {
    await requireAdmin(req);
    const { filter, q, limit } = ListQuery.parse(req.query);

    const where: Prisma.PlayerWhereInput = {
      ...(filter === "missing" ? { positions: { isEmpty: true }, positionsOverride: { isEmpty: true } } : {}),
      ...(filter === "overridden" ? { NOT: { positionsOverride: { isEmpty: true } } } : {}),
      ...(q
        ? {
            // Every word must match the first or last name.
            AND: q.split(/\s+/).map((word) => ({
              OR: [
                { firstName: { contains: word, mode: "insensitive" as const } },
                { lastName: { contains: word, mode: "insensitive" as const } },
              ],
            })),
          }
        : {}),
    };
    const players = await db.player.findMany({
      where,
      select: playerSelect,
      // Most-used players first: they matter most for drafting.
      orderBy: [{ appearances: { _count: "desc" } }, { lastName: "asc" }],
      take: limit,
    });
    return players.map(toAdminPlayer);
  });

  app.patch<{ Params: { id: string } }>("/api/admin/players/:id", async (req) => {
    const admin = await requireAdmin(req);
    const id = Number(req.params.id);
    const { positionsOverride } = UpdatePlayerPositionsInput.parse(req.body);
    const existing = await db.player.findUnique({ where: { id: Number.isInteger(id) ? id : -1 } });
    if (!existing) throw notFound("Player");
    const updated = await db.player.update({ where: { id }, data: { positionsOverride }, select: playerSelect });
    req.log.info({ admin: admin.email, playerId: id, positionsOverride }, "player positions overridden");
    return toAdminPlayer(updated);
  });
}
