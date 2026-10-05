import type { NrlPosition } from "@nrl/shared";

const LABEL_TO_POSITION: Record<string, NrlPosition> = {
  fullback: "FB",
  winger: "WG",
  wing: "WG",
  centre: "CE",
  center: "CE",
  "five-eighth": "FE",
  "five eighth": "FE",
  halfback: "HB",
  hooker: "HK",
  prop: "FRF",
  "front row": "FRF",
  "2nd row": "2RF",
  "second row": "2RF",
  "second-row": "2RF",
  lock: "LK",
};

/** "Five-Eighth" -> "FE". Interchange / Reserve / unknown -> null. */
export function positionFromLabel(label: string): NrlPosition | null {
  return LABEL_TO_POSITION[label.trim().toLowerCase()] ?? null;
}

export interface Start {
  season: number;
  position: NrlPosition;
}

/**
 * Fantasy positions for a player, from the positions they started at.
 *
 * Uses the most recent season in which they started at least once, and keeps
 * every position that made up at least 25% of that season's starts or was
 * started 3+ times, most-started first. A one-off emergency start in an odd
 * position doesn't make a player dual-position.
 */
export function derivePositions(starts: readonly Start[]): NrlPosition[] {
  if (starts.length === 0) return [];
  const latest = Math.max(...starts.map((s) => s.season));
  const counts = new Map<NrlPosition, number>();
  for (const s of starts) {
    if (s.season === latest) counts.set(s.position, (counts.get(s.position) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return [...counts.entries()]
    .filter(([, n]) => n >= 3 || n / total >= 0.25)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);
}
