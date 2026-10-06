import { z } from "zod";
import type { RosterTemplate } from "./leagueSettings.ts";
import type { NrlPosition } from "./positions.ts";

// A team's lineup for a round: who starts in each slot, and the bench in
// emergency order. Every player in the squad appears exactly once.

export const LineupInput = z.object({
  /** Slot key -> player ids in that slot's positions (null = empty). */
  starters: z.record(z.string(), z.array(z.number().int().nullable())),
  /** Everyone else, first emergency first. */
  bench: z.array(z.number().int()),
});
export type Lineup = z.infer<typeof LineupInput>;

export interface SquadPlayer {
  id: number;
  positions: readonly NrlPosition[];
}

/** Where a player sits: "FWD:1" (slot key + index) or "bench:2". */
export type Spot = string;

export function spotsOf(lineup: Lineup): Map<number, Spot> {
  const spots = new Map<number, Spot>();
  for (const [key, ids] of Object.entries(lineup.starters)) {
    ids.forEach((id, i) => {
      if (id !== null) spots.set(id, `${key}:${i}`);
    });
  }
  lineup.bench.forEach((id, i) => spots.set(id, `bench:${i}`));
  return spots;
}

/** Problems with a lineup for this squad and template; empty = valid. */
export function lineupErrors(template: RosterTemplate, squad: readonly SquadPlayer[], lineup: Lineup): string[] {
  const errors: string[] = [];
  const byId = new Map(squad.map((p) => [p.id, p]));
  const seen = new Set<number>();
  const note = (id: number) => {
    if (!byId.has(id)) errors.push(`Player ${id} isn't in your squad`);
    else if (seen.has(id)) errors.push(`Player ${id} is listed twice`);
    seen.add(id);
  };

  const slotKeys = new Set(template.slots.map((s) => s.key));
  for (const key of Object.keys(lineup.starters)) {
    if (!slotKeys.has(key)) errors.push(`Unknown slot ${key}`);
  }
  for (const slot of template.slots) {
    const ids = lineup.starters[slot.key] ?? [];
    if (ids.length > slot.count) errors.push(`${slot.label} has room for ${slot.count}`);
    for (const id of ids) {
      if (id === null) continue;
      note(id);
      const p = byId.get(id);
      if (p && !p.positions.some((pos) => slot.eligible.includes(pos))) {
        errors.push(`Player ${id} can't play ${slot.label}`);
      }
    }
  }
  for (const id of lineup.bench) note(id);
  for (const p of squad) if (!seen.has(p.id)) errors.push(`Player ${p.id} is missing from the lineup`);
  return errors;
}

/**
 * Players who are locked (their match has kicked off) must stay exactly where
 * they were, and nobody else can take their spot. Returns the ids that moved.
 */
export function movedLockedPlayers(current: Lineup, next: Lineup, isLocked: (playerId: number) => boolean): number[] {
  const before = spotsOf(current);
  const after = spotsOf(next);
  const moved: number[] = [];
  for (const [id, spot] of before) {
    if (isLocked(id) && after.get(id) !== spot) moved.push(id);
  }
  return moved;
}

/**
 * Keep a lineup in step with the squad: drop players who've left, put new
 * players at the end of the bench, and pad slots to their size.
 */
export function reconcileLineup(template: RosterTemplate, squad: readonly SquadPlayer[], lineup: Lineup): Lineup {
  const ids = new Set(squad.map((p) => p.id));
  const used = new Set<number>();
  const keep = (id: number | null) => {
    if (id === null || !ids.has(id) || used.has(id)) return null;
    used.add(id);
    return id;
  };
  const starters: Lineup["starters"] = {};
  for (const slot of template.slots) {
    const current = (lineup.starters[slot.key] ?? []).slice(0, slot.count).map(keep);
    while (current.length < slot.count) current.push(null);
    starters[slot.key] = current;
  }
  const bench = lineup.bench.map(keep).filter((id): id is number => id !== null);
  for (const p of squad) if (!used.has(p.id)) bench.push(p.id);
  return { starters, bench };
}

/**
 * A sensible lineup from a squad listed best first: fill the most
 * restrictive slots first with the best eligible player; everyone else goes
 * on the bench in the same order.
 */
export function autoLineup(template: RosterTemplate, squadBestFirst: readonly SquadPlayer[]): Lineup {
  const used = new Set<number>();
  const starters: Lineup["starters"] = Object.fromEntries(
    template.slots.map((s) => [s.key, Array.from({ length: s.count }, () => null as number | null)]),
  );
  const slots = [...template.slots].sort((a, b) => a.eligible.length - b.eligible.length);
  for (const slot of slots) {
    for (let i = 0; i < slot.count; i++) {
      const p = squadBestFirst.find((x) => !used.has(x.id) && x.positions.some((pos) => slot.eligible.includes(pos)));
      if (!p) break;
      used.add(p.id);
      starters[slot.key]![i] = p.id;
    }
  }
  return { starters, bench: squadBestFirst.filter((p) => !used.has(p.id)).map((p) => p.id) };
}
