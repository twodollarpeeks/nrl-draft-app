// Finals brackets for top 4, top 6 and top 8. Seeds are the finals teams in
// ladder order (index 0 = minor premier). In every final the higher seed is
// listed first (the "home" team) and wins a drawn game.
//
// Top 4 (2 weeks): semis 1v4, 2v3; grand final.
// Top 6 (3 weeks): elimination 1v6, 2v5, 3v4; the three winners plus the
//   highest-ranked loser go through and are re-seeded (best plays worst);
//   grand final.
// Top 8 (4 weeks), the NRL system:
//   wk1 qualifying finals QF1 1v4, QF2 2v3 (losers get a second chance) and
//       elimination finals EF1 5v8, EF2 6v7 (losers are out)
//   wk2 semi-finals SF1 loser QF1 v winner EF1, SF2 loser QF2 v winner EF2
//   wk3 preliminary finals PF1 winner QF1 v winner SF2, PF2 winner QF2 v winner SF1
//   wk4 grand final

export type FinalsSize = 4 | 6 | 8;

export interface FinalsGame<T> {
  id: string; // e.g. "QF1", "SF2", "GF"
  /** 1-based week of the finals. */
  week: number;
  label: string;
  /** Higher seed first. Null until the teams are known. */
  home: T | null;
  away: T | null;
  winner: T | null;
  loser: T | null;
}

export interface FinalsBracket<T> {
  size: FinalsSize;
  weeks: number;
  games: FinalsGame<T>[];
  champion: T | null;
}

/** [homePoints, awayPoints] once a game between these two is final, else null. */
export type FinalsScore<T> = (home: T, away: T) => readonly [number, number] | null;

export function finalsBracket<T>(size: FinalsSize, seeds: readonly T[], score: FinalsScore<T>): FinalsBracket<T> {
  if (seeds.length !== size) throw new Error(`Need ${size} finals teams, got ${seeds.length}`);
  const seedOf = (t: T) => seeds.indexOf(t);
  const games: FinalsGame<T>[] = [];

  const play = (id: string, week: number, label: string, a: T | null, b: T | null): FinalsGame<T> => {
    let home = a;
    let away = b;
    if (a !== null && b !== null && seedOf(b) < seedOf(a)) [home, away] = [b, a];
    let winner: T | null = null;
    let loser: T | null = null;
    if (home !== null && away !== null) {
      const s = score(home, away);
      if (s) [winner, loser] = s[1] > s[0] ? [away, home] : [home, away];
    }
    const g = { id, week, label, home, away, winner, loser };
    games.push(g);
    return g;
  };

  if (size === 4) {
    const sf1 = play("SF1", 1, "Semi-final 1", seeds[0]!, seeds[3]!);
    const sf2 = play("SF2", 1, "Semi-final 2", seeds[1]!, seeds[2]!);
    const gf = play("GF", 2, "Grand final", sf1.winner, sf2.winner);
    return { size, weeks: 2, games, champion: gf.winner };
  }

  if (size === 6) {
    const week1 = [
      play("EF1", 1, "Elimination final 1", seeds[0]!, seeds[5]!),
      play("EF2", 1, "Elimination final 2", seeds[1]!, seeds[4]!),
      play("EF3", 1, "Elimination final 3", seeds[2]!, seeds[3]!),
    ];
    // Wait for all of week 1: the lucky loser depends on every result.
    let advancing: T[] | null = null;
    if (week1.every((g) => g.winner !== null)) {
      const winners = week1.map((g) => g.winner!);
      const bestLoser = week1.map((g) => g.loser!).sort((a, b) => seedOf(a) - seedOf(b))[0]!;
      advancing = [...winners, bestLoser].sort((a, b) => seedOf(a) - seedOf(b));
    }
    const sf1 = play("SF1", 2, "Semi-final 1", advancing?.[0] ?? null, advancing?.[3] ?? null);
    const sf2 = play("SF2", 2, "Semi-final 2", advancing?.[1] ?? null, advancing?.[2] ?? null);
    const gf = play("GF", 3, "Grand final", sf1.winner, sf2.winner);
    return { size, weeks: 3, games, champion: gf.winner };
  }

  const qf1 = play("QF1", 1, "Qualifying final 1", seeds[0]!, seeds[3]!);
  const qf2 = play("QF2", 1, "Qualifying final 2", seeds[1]!, seeds[2]!);
  const ef1 = play("EF1", 1, "Elimination final 1", seeds[4]!, seeds[7]!);
  const ef2 = play("EF2", 1, "Elimination final 2", seeds[5]!, seeds[6]!);
  const sf1 = play("SF1", 2, "Semi-final 1", qf1.loser, ef1.winner);
  const sf2 = play("SF2", 2, "Semi-final 2", qf2.loser, ef2.winner);
  const pf1 = play("PF1", 3, "Preliminary final 1", qf1.winner, sf2.winner);
  const pf2 = play("PF2", 3, "Preliminary final 2", qf2.winner, sf1.winner);
  const gf = play("GF", 4, "Grand final", pf1.winner, pf2.winner);
  return { size, weeks: 4, games, champion: gf.winner };
}
