// Top-4 finals: semi-finals 1v4 and 2v3, then a grand final. A drawn final is
// won by the higher seed (it finished higher on the ladder).

export interface FinalsGame<T> {
  stage: "semi" | "grandFinal";
  /** Higher seed first. Null until the semis are decided. */
  home: T | null;
  away: T | null;
  winner: T | null;
}

export interface FinalsBracket<T> {
  semis: [FinalsGame<T>, FinalsGame<T>];
  grandFinal: FinalsGame<T>;
  champion: T | null;
}

/**
 * Build the bracket from the top 4 (in ladder order) and whatever finals
 * scores are known. `score(a, b)` returns [aPoints, bPoints] once that game is
 * final, or null.
 */
export function topFourBracket<T>(
  seeds: readonly [T, T, T, T],
  score: (a: T, b: T) => readonly [number, number] | null,
): FinalsBracket<T> {
  const play = (stage: FinalsGame<T>["stage"], home: T | null, away: T | null): FinalsGame<T> => {
    if (home === null || away === null) return { stage, home, away, winner: null };
    const s = score(home, away);
    // Draw: higher seed (home) goes through.
    const winner = s === null ? null : s[1] > s[0] ? away : home;
    return { stage, home, away, winner };
  };

  const semi1 = play("semi", seeds[0], seeds[3]);
  const semi2 = play("semi", seeds[1], seeds[2]);
  const [gfHome, gfAway] = bySeed(seeds, semi1.winner, semi2.winner);
  const grandFinal = play("grandFinal", gfHome, gfAway);
  return { semis: [semi1, semi2], grandFinal, champion: grandFinal.winner };
}

function bySeed<T>(seeds: readonly T[], a: T | null, b: T | null): [T | null, T | null] {
  if (a === null || b === null) return [a, b];
  return seeds.indexOf(a) <= seeds.indexOf(b) ? [a, b] : [b, a];
}
