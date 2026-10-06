import { z } from "zod";

// Real NRL positions a player can be eligible for. A player usually has one,
// sometimes two (e.g. a hooker who also plays lock).
export const NRL_POSITIONS = [
  "FB", // fullback
  "WG", // winger
  "CE", // centre
  "FE", // five-eighth
  "HB", // halfback
  "HK", // hooker
  "FRF", // front-row forward (prop)
  "2RF", // second-row forward
  "LK", // lock
] as const;

export const NrlPosition = z.enum(NRL_POSITIONS);
export type NrlPosition = z.infer<typeof NrlPosition>;

export const POSITION_LABELS: Record<NrlPosition, string> = {
  FB: "Fullback",
  WG: "Winger",
  CE: "Centre",
  FE: "Five-Eighth",
  HB: "Halfback",
  HK: "Hooker",
  FRF: "Front Row",
  "2RF": "Second Row",
  LK: "Lock",
};

/** Positions a player can fill: an admin override wins over derived ones. */
export function effectivePositions(p: {
  positions: readonly string[];
  positionsOverride: readonly string[];
}): NrlPosition[] {
  const list = p.positionsOverride.length > 0 ? p.positionsOverride : p.positions;
  return list.filter((x): x is NrlPosition => (NRL_POSITIONS as readonly string[]).includes(x));
}

/** Colour/grouping bucket for a position: halves & hookers, forwards, outside backs. */
export type PositionGroup = "half" | "fwd" | "ob";

const GROUP_OF: Record<NrlPosition, PositionGroup> = {
  HB: "half", FE: "half", HK: "half",
  FRF: "fwd", "2RF": "fwd", LK: "fwd",
  FB: "ob", WG: "ob", CE: "ob",
};

export const POSITION_GROUP_LABELS: Record<PositionGroup, string> = {
  half: "Halves & hookers",
  fwd: "Forwards",
  ob: "Outside backs",
};

/** The group of a player's first-listed position (null if they have none). */
export function positionGroup(positions: readonly NrlPosition[]): PositionGroup | null {
  return positions[0] ? GROUP_OF[positions[0]] : null;
}

// The site only ever shows these groups (the app's positions), never the NRL
// positions behind them.
export const POSITION_GROUPS = ["half", "fwd", "ob"] as const satisfies readonly PositionGroup[];

export const POSITION_GROUP_SHORT: Record<PositionGroup, string> = {
  half: "HF/HK",
  fwd: "FWD",
  ob: "OB",
};

/** The NRL positions that make up each group. */
export const GROUP_POSITIONS: Record<PositionGroup, NrlPosition[]> = {
  half: ["HB", "FE", "HK"],
  fwd: ["FRF", "2RF", "LK"],
  ob: ["FB", "WG", "CE"],
};

/** Every group a player can play, their main one first. */
export function positionGroups(positions: readonly NrlPosition[]): PositionGroup[] {
  return [...new Set(positions.map((p) => GROUP_OF[p]))];
}

/** "HF/HK", or "FWD · OB" for a player in two groups; "" for none. */
export function groupsLabel(positions: readonly NrlPosition[]): string {
  return positionGroups(positions)
    .map((g) => POSITION_GROUP_SHORT[g])
    .join(" · ");
}
