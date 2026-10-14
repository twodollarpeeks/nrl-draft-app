import type { RosterTemplate } from "./leagueSettings.ts";
import { squadSize, starterCount } from "./leagueSettings.ts";
import type { NrlPosition } from "./positions.ts";

// Pure snake-draft rules, shared by the server (which enforces them) and the
// web app (which uses them to show whose turn it is and grey out bad picks).

/** 1-based round for an overall pick number. */
export function roundOf(teamCount: number, pickNo: number): number {
  return Math.ceil(pickNo / teamCount);
}

/** Index into the round-1 order of the team picking at `pickNo` (snake). */
export function snakeIndex(teamCount: number, pickNo: number): number {
  const round = roundOf(teamCount, pickNo);
  const inRound = (pickNo - 1) % teamCount;
  return round % 2 === 1 ? inRound : teamCount - 1 - inRound;
}

export function teamForPick<T>(order: readonly T[], pickNo: number): T {
  return order[snakeIndex(order.length, pickNo)]!;
}

/** The overall pick numbers a team (by round-1 index) makes, in order. */
export function picksForTeam(teamCount: number, rounds: number, index: number): number[] {
  const picks: number[] = [];
  for (let round = 1; round <= rounds; round++) {
    const inRound = round % 2 === 1 ? index : teamCount - 1 - index;
    picks.push((round - 1) * teamCount + inRound + 1);
  }
  return picks;
}

/**
 * How many starting slots a set of players can fill at once (maximum
 * bipartite matching of players to individual slots). A player fills at most
 * one slot; a slot takes one player whose positions include an eligible one.
 */
export function startersFillable(template: RosterTemplate, players: ReadonlyArray<readonly NrlPosition[]>): number {
  const slots = template.slots.flatMap((s) => Array.from({ length: s.count }, () => s.eligible));
  const slotOwner: Array<number | null> = slots.map(() => null);

  const tryAssign = (player: number, seen: boolean[]): boolean => {
    const positions = players[player]!;
    for (let s = 0; s < slots.length; s++) {
      if (seen[s] || !positions.some((p) => slots[s]!.includes(p))) continue;
      seen[s] = true;
      const owner = slotOwner[s]!;
      if (owner === null || tryAssign(owner, seen)) {
        slotOwner[s] = player;
        return true;
      }
    }
    return false;
  };

  let filled = 0;
  for (let p = 0; p < players.length; p++) {
    if (tryAssign(p, slots.map(() => false))) filled++;
  }
  return filled;
}

export type DraftCheck = { ok: true } | { ok: false; reason: string };

/**
 * Can a team with `roster` draft a player with `positions`? Their squad must
 * not be full, and after this pick they must still have enough picks left to
 * fill every starting slot. So early on anyone goes (they can sit on the
 * bench), but late picks have to fill starting gaps.
 */
export function checkDraftable(
  template: RosterTemplate,
  roster: ReadonlyArray<readonly NrlPosition[]>,
  positions: readonly NrlPosition[],
): DraftCheck {
  const size = squadSize(template);
  if (roster.length >= size) return { ok: false, reason: "Your squad is full" };
  const picksLeftAfter = size - roster.length - 1;
  const gapsAfter = starterCount(template) - startersFillable(template, [...roster, positions]);
  if (gapsAfter > picksLeftAfter) {
    return { ok: false, reason: "You need to fill a starting spot with this pick" };
  }
  return { ok: true };
}

/**
 * Autopick: the first player in the manager's queue they can draft, otherwise
 * the best-ranked available player they can draft. Null if nobody fits.
 */
export function chooseAutopick(input: {
  template: RosterTemplate;
  roster: ReadonlyArray<readonly NrlPosition[]>;
  queue: readonly number[];
  ranked: readonly number[]; // best first
  isAvailable: (playerId: number) => boolean;
  positionsOf: (playerId: number) => readonly NrlPosition[];
}): number | null {
  const fits = (id: number) =>
    input.isAvailable(id) && checkDraftable(input.template, input.roster, input.positionsOf(id)).ok;
  return input.queue.find(fits) ?? input.ranked.find(fits) ?? null;
}

/**
 * A CPU team's pick in a mock draft: one of the best few available players it
 * can draft, chosen at random but leaning towards the higher-ranked ones and
 * towards players who fill a starting spot it still needs. So CPUs draft
 * sensibly without every mock playing out the same way.
 */
export function chooseCpuPick(input: {
  template: RosterTemplate;
  roster: ReadonlyArray<readonly NrlPosition[]>;
  ranked: readonly number[]; // best first
  isAvailable: (playerId: number) => boolean;
  positionsOf: (playerId: number) => readonly NrlPosition[];
  /** Returns [0, 1); injectable for tests. */
  random?: () => number;
  /** How many of the best available players to choose between. */
  shortlist?: number;
}): number | null {
  const { template, roster, positionsOf } = input;
  const random = input.random ?? Math.random;
  const filled = startersFillable(template, roster);
  const options: Array<{ id: number; weight: number }> = [];
  for (const id of input.ranked) {
    if (options.length >= (input.shortlist ?? 5)) break;
    if (!input.isAvailable(id) || !checkDraftable(template, roster, positionsOf(id)).ok) continue;
    const fillsSpot = startersFillable(template, [...roster, positionsOf(id)]) > filled;
    // Each step down the shortlist is a bit less likely; needed positions get a boost.
    options.push({ id, weight: 0.65 ** options.length * (fillsSpot ? 2 : 1) });
  }
  if (options.length === 0) return null;
  let r = random() * options.reduce((sum, o) => sum + o.weight, 0);
  for (const o of options) {
    r -= o.weight;
    if (r < 0) return o.id;
  }
  return options[options.length - 1]!.id;
}
