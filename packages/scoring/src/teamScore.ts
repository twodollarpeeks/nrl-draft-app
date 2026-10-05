import type { NrlPosition, RosterTemplate } from "@nrl/shared";
import { roundPoints } from "./playerPoints.ts";

/**
 * Where a player stands for the round:
 * - "played":  took the field (minutes > 0) — points count
 * - "dnp":     definitely won't score: bye, not named, or named but 0 minutes
 *              after full time — triggers an emergency
 * - "pending": their match hasn't finished yet
 */
export type PlayerStatus = "played" | "dnp" | "pending";

export interface PlayerRoundResult {
  status: PlayerStatus;
  points: number; // live/provisional while the match is in progress; 0 if dnp
  positions: readonly NrlPosition[];
}

/** Decide a player's status from their club's match and their appearance in it. */
export function playerStatus(input: {
  clubHasMatch: boolean; // false = bye
  matchFinished: boolean;
  matchStarted: boolean;
  named: boolean; // in the team list (jersey 1-22)
  minutes: number | null;
}): PlayerStatus {
  if (!input.clubHasMatch) return "dnp";
  if (input.matchFinished) return input.named && (input.minutes ?? 0) > 0 ? "played" : "dnp";
  // In progress: anyone already on the field counts as played so far.
  if (input.matchStarted && input.named && (input.minutes ?? 0) > 0) return "played";
  if (input.matchStarted && !input.named) return "dnp";
  return "pending";
}

export interface Lineup {
  /** Starters by slot key, in slot order, e.g. { FWD: [12, 34, null] }. */
  starters: Record<string, ReadonlyArray<number | null>>;
  /** Bench in emergency order: first is first emergency. */
  bench: readonly number[];
}

export interface ScoredSlot {
  slotKey: string;
  index: number;
  starterId: number | null;
  /** Who actually scored for this slot (the starter, an emergency, or nobody). */
  scorerId: number | null;
  points: number;
  viaEmergency: boolean;
}

export interface TeamRoundScore {
  total: number;
  /** True while any starter or still-needed emergency hasn't finished. */
  provisional: boolean;
  slots: ScoredSlot[];
}

/**
 * Score a team's round. Only starters score. A starter who doesn't play is
 * replaced by the first bench player, in emergency order, who is eligible for
 * that slot, played, and hasn't already replaced someone. Slots are filled in
 * template order (e.g. HF/HK, then FWD, OB, FLEX).
 *
 * While an emergency ahead in the order is still pending, we can't know
 * whether they'll play, so the slot scores 0 for now and the result is
 * provisional rather than skipping ahead to a later emergency.
 */
export function scoreTeamRound(
  template: RosterTemplate,
  lineup: Lineup,
  results: ReadonlyMap<number, PlayerRoundResult>,
): TeamRoundScore {
  const usedBench = new Set<number>();
  const slots: ScoredSlot[] = [];
  let provisional = false;

  const resultFor = (id: number): PlayerRoundResult =>
    results.get(id) ?? { status: "dnp", points: 0, positions: [] };

  for (const slot of template.slots) {
    const assigned = lineup.starters[slot.key] ?? [];
    for (let index = 0; index < slot.count; index++) {
      const starterId = assigned[index] ?? null;
      const base = { slotKey: slot.key, index, starterId };

      if (starterId !== null) {
        const r = resultFor(starterId);
        if (r.status !== "dnp") {
          if (r.status === "pending") provisional = true;
          slots.push({ ...base, scorerId: starterId, points: r.status === "played" ? r.points : 0, viaEmergency: false });
          continue;
        }
      }

      // Starter is missing or didn't play: look for an emergency.
      let scorer: ScoredSlot | null = null;
      for (const benchId of lineup.bench) {
        if (usedBench.has(benchId)) continue;
        const r = resultFor(benchId);
        if (!r.positions.some((p) => slot.eligible.includes(p))) continue;
        if (r.status === "dnp") continue;
        if (r.status === "pending") {
          provisional = true;
          break; // wait for them rather than jumping the queue
        }
        usedBench.add(benchId);
        scorer = { ...base, scorerId: benchId, points: r.points, viaEmergency: true };
        break;
      }
      slots.push(scorer ?? { ...base, scorerId: null, points: 0, viaEmergency: false });
    }
  }

  return {
    total: roundPoints(slots.reduce((sum, s) => sum + s.points, 0)),
    provisional,
    slots,
  };
}

/** Whether a player can fill a slot with this eligibility list. */
export function canFill(positions: readonly NrlPosition[], eligible: readonly NrlPosition[]): boolean {
  return positions.some((p) => eligible.includes(p));
}
