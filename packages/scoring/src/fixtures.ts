export interface Pairing<T> {
  home: T;
  away: T;
}

/**
 * Head-to-head fixture list for `rounds` rounds, using the circle method so
 * everyone plays everyone once per cycle, then repeats with home/away swapped.
 * With an odd number of teams, one team has a bye each round (not listed).
 */
export function roundRobin<T>(teams: readonly T[], rounds: number): Pairing<T>[][] {
  if (teams.length < 2) return Array.from({ length: rounds }, () => []);
  const BYE = Symbol("bye");
  const ring: Array<T | typeof BYE> = [...teams];
  if (ring.length % 2 === 1) ring.push(BYE);
  const n = ring.length;
  const cycle = n - 1;

  const schedule: Pairing<T>[][] = [];
  for (let r = 0; r < rounds; r++) {
    const k = r % cycle;
    const swap = Math.floor(r / cycle) % 2 === 1;
    // Rotate everyone except the first team by k places.
    const order = [ring[0]!, ...rotate(ring.slice(1), k)];
    const round: Pairing<T>[] = [];
    for (let i = 0; i < n / 2; i++) {
      const x = order[i]!;
      const y = order[n - 1 - i]!;
      if (x === BYE || y === BYE) continue;
      const a = x as T;
      const b = y as T;
      // Alternate the fixed team's home/away so nobody is always home.
      const flip = (i === 0 && k % 2 === 1) !== swap;
      round.push(flip ? { home: b, away: a } : { home: a, away: b });
    }
    schedule.push(round);
  }
  return schedule;
}

function rotate<T>(arr: T[], k: number): T[] {
  if (arr.length === 0) return arr;
  const s = k % arr.length;
  return [...arr.slice(arr.length - s), ...arr.slice(0, arr.length - s)];
}
