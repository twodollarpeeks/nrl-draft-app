// Waivers: unowned players who were just dropped, or whose game this round
// has started, can only be claimed, not picked up straight away. Claims settle
// once a week, Wednesday 6am Sydney time (after Tuesday's team lists), in
// rolling waiver order: a team that wins a claim goes to the back of the line.

export const WAIVER_TIME_ZONE = "Australia/Sydney";
/** Wednesday (0 = Sunday), 6am. */
export const WAIVER_WEEKDAY = 3;
export const WAIVER_HOUR = 6;

const DAY_MS = 86_400_000;

/** Minutes a time zone is ahead of UTC at an instant (e.g. 600 for AEST). */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return Math.round((wall - instant.getTime()) / 60_000);
}

/** The instant a wall-clock time happens in a time zone. */
function zonedTime(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month, day, hour);
  // Twice, in case the guess lands on the other side of a daylight-saving change.
  let t = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  t = guess - zoneOffsetMinutes(new Date(t), timeZone) * 60_000;
  return new Date(t);
}

/** Waiver clearing times around `now`: the latest at or before it, and the next one after it. */
export function waiverClearings(now: Date): { last: Date; next: Date } {
  // Today's date in Sydney, then step back to the most recent Wednesday.
  const local = new Date(now.getTime() + zoneOffsetMinutes(now, WAIVER_TIME_ZONE) * 60_000);
  const back = (local.getUTCDay() - WAIVER_WEEKDAY + 7) % 7;
  const at = (daysBack: number) => {
    const d = new Date(local.getTime() - daysBack * DAY_MS);
    return zonedTime(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), WAIVER_HOUR, WAIVER_TIME_ZONE);
  };
  // This Wednesday's clearing, unless it's still to come today.
  const thisWeek = at(back);
  return thisWeek <= now ? { last: thisWeek, next: at(back - 7) } : { last: at(back + 7), next: thisWeek };
}

export interface ClaimInput {
  id: string;
  teamId: string;
  playerId: number;
  dropPlayerId: number | null;
  /** The team's own order for its claims, 1 first. */
  rank: number;
}

export type ClaimOutcome =
  | { status: "won" }
  | { status: "lost"; note: string }
  | { status: "failed"; note: string };

/**
 * Settle a round of waiver claims. Teams take turns in `order`: the first team
 * with a claim that can go through gets it and moves to the back, then it
 * starts again from the front. A claim that can't go through any more (the
 * player went to a team ahead, the drop player has gone, the squad's full)
 * is passed over.
 */
export function resolveWaivers(input: {
  order: readonly string[];
  claims: readonly ClaimInput[];
  /** Current owner of each player in the league (absent = unowned). */
  owners: ReadonlyMap<number, string>;
  squadSizes: ReadonlyMap<string, number>;
  maxSquad: number;
  /** Players whose game has started: they can't be added or let go right now. */
  isLocked: (playerId: number) => boolean;
  playerName?: (playerId: number) => string;
}): { outcomes: Map<string, ClaimOutcome>; order: string[] } {
  const name = input.playerName ?? ((id: number) => `Player ${id}`);
  const owners = new Map(input.owners);
  const sizes = new Map(input.squadSizes);
  const order = [...input.order];
  const outcomes = new Map<string, ClaimOutcome>();
  const wonBy = new Map<number, string>(); // players won in this run, by team
  const pending = [...input.claims].sort((a, b) => a.rank - b.rank);

  // Why a claim can't go through now, or null if it can.
  const blocker = (c: ClaimInput): ClaimOutcome | null => {
    const owner = owners.get(c.playerId);
    if (owner !== undefined) {
      return wonBy.has(c.playerId)
        ? { status: "lost", note: `${name(c.playerId)} went to a team ahead of you in waiver order` }
        : { status: "failed", note: `${name(c.playerId)} is already on a team` };
    }
    if (input.isLocked(c.playerId)) return { status: "failed", note: `${name(c.playerId)}'s game has started` };
    if (c.dropPlayerId !== null) {
      if (owners.get(c.dropPlayerId) !== c.teamId) {
        return { status: "failed", note: `${name(c.dropPlayerId)} is no longer in your squad` };
      }
      if (input.isLocked(c.dropPlayerId)) return { status: "failed", note: `${name(c.dropPlayerId)}'s game has started` };
    }
    const after = (sizes.get(c.teamId) ?? 0) + 1 - (c.dropPlayerId !== null ? 1 : 0);
    if (after > input.maxSquad) return { status: "failed", note: "Your squad was full: choose someone to drop" };
    return null;
  };

  for (;;) {
    let winner: ClaimInput | null = null;
    for (const teamId of order) {
      for (const c of pending) {
        if (c.teamId !== teamId || outcomes.has(c.id)) continue;
        const blocked = blocker(c);
        if (blocked) {
          outcomes.set(c.id, blocked);
          continue;
        }
        winner = c;
        break;
      }
      if (winner) break;
    }
    if (!winner) break;
    outcomes.set(winner.id, { status: "won" });
    owners.set(winner.playerId, winner.teamId);
    wonBy.set(winner.playerId, winner.teamId);
    if (winner.dropPlayerId !== null) owners.delete(winner.dropPlayerId);
    sizes.set(winner.teamId, (sizes.get(winner.teamId) ?? 0) + 1 - (winner.dropPlayerId !== null ? 1 : 0));
    order.splice(order.indexOf(winner.teamId), 1);
    order.push(winner.teamId);
  }
  return { outcomes, order };
}
