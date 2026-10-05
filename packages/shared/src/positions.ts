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
