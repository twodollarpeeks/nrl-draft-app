import { describe, expect, it } from "vitest";
import { finalsBracket, type FinalsGame } from "./finals.ts";

const seeds = (n: number) => Array.from({ length: n }, (_, i) => `S${i + 1}`);

/** Scores keyed "home-away"; a missing key means not played yet. */
const scorer = (scores: Record<string, readonly [number, number]>) => (h: string, a: string) => scores[`${h}-${a}`] ?? null;

const pairs = (games: FinalsGame<string>[], week: number) =>
  games.filter((g) => g.week === week).map((g) => `${g.id}:${g.home}v${g.away}`);

describe("top 4", () => {
  it("pairs 1v4 and 2v3, then the grand final", () => {
    const b = finalsBracket(4, seeds(4), () => null);
    expect(b.weeks).toBe(2);
    expect(pairs(b.games, 1)).toEqual(["SF1:S1vS4", "SF2:S2vS3"]);
    expect(pairs(b.games, 2)).toEqual(["GF:nullvnull"]);
    expect(b.champion).toBeNull();
  });

  it("lists the higher seed first in the grand final, and a draw goes to them", () => {
    const b = finalsBracket(4, seeds(4), scorer({ "S1-S4": [0, 10], "S2-S3": [0, 10], "S3-S4": [70, 70] }));
    expect(pairs(b.games, 2)).toEqual(["GF:S3vS4"]);
    expect(b.champion).toBe("S3");
  });
});

describe("top 6", () => {
  it("plays 1v6, 2v5, 3v4 in week 1", () => {
    const b = finalsBracket(6, seeds(6), () => null);
    expect(b.weeks).toBe(3);
    expect(pairs(b.games, 1)).toEqual(["EF1:S1vS6", "EF2:S2vS5", "EF3:S3vS4"]);
    // Week 2 waits for every week 1 result.
    expect(pairs(b.games, 2)).toEqual(["SF1:nullvnull", "SF2:nullvnull"]);
  });

  it("sends the three winners plus the highest-ranked loser through, re-seeded", () => {
    // S1 loses to S6 (upset), S2 beats S5, S4 beats S3. Losers: S1, S5, S3; best loser S1.
    // Advancing by seed: S1, S2, S4, S6 -> semis S1vS6, S2vS4.
    const b = finalsBracket(6, seeds(6), scorer({ "S1-S6": [10, 20], "S2-S5": [30, 10], "S3-S4": [5, 15] }));
    expect(pairs(b.games, 2)).toEqual(["SF1:S1vS6", "SF2:S2vS4"]);
  });

  it("plays out to a champion", () => {
    const b = finalsBracket(
      6,
      seeds(6),
      scorer({ "S1-S6": [20, 10], "S2-S5": [30, 10], "S3-S4": [15, 5], "S1-S4": [1, 2], "S2-S3": [9, 8], "S2-S4": [10, 5] }),
    );
    // Advancing: S1, S2, S3 (winners) + S4 (best loser: S4 > S5 > S6) -> S1vS4, S2vS3.
    expect(pairs(b.games, 2)).toEqual(["SF1:S1vS4", "SF2:S2vS3"]);
    expect(pairs(b.games, 3)).toEqual(["GF:S2vS4"]);
    expect(b.champion).toBe("S2");
  });
});

describe("top 8 (NRL system)", () => {
  // Week 1: S4 upsets S1, S2 beats S3; S5 beats S8, S7 upsets S6.
  const week1 = { "S1-S4": [10, 20], "S2-S3": [20, 10], "S5-S8": [20, 10], "S6-S7": [10, 20] } as const;

  it("plays qualifying finals 1v4, 2v3 and elimination finals 5v8, 6v7", () => {
    const b = finalsBracket(8, seeds(8), () => null);
    expect(b.weeks).toBe(4);
    expect(pairs(b.games, 1)).toEqual(["QF1:S1vS4", "QF2:S2vS3", "EF1:S5vS8", "EF2:S6vS7"]);
  });

  it("gives qualifying-final losers a second chance; elimination losers are out", () => {
    const b = finalsBracket(8, seeds(8), scorer({ ...week1 }));
    // SF1: loser QF1 (S1) v winner EF1 (S5); SF2: loser QF2 (S3) v winner EF2 (S7).
    expect(pairs(b.games, 2)).toEqual(["SF1:S1vS5", "SF2:S3vS7"]);
    // Qualifying-final winners skip week 2; their preliminary-final opponents are still to come.
    expect(pairs(b.games, 3)).toEqual(["PF1:S4vnull", "PF2:S2vnull"]);
  });

  it("matches QF winners with the semi winners from the other side", () => {
    const b = finalsBracket(8, seeds(8), scorer({ ...week1, "S1-S5": [30, 10], "S3-S7": [10, 30] }));
    // PF1: winner QF1 (S4) v winner SF2 (S7); PF2: winner QF2 (S2) v winner SF1 (S1). Higher seed first.
    expect(pairs(b.games, 3)).toEqual(["PF1:S4vS7", "PF2:S1vS2"]);
  });

  it("plays out to a champion; a drawn grand final goes to the higher seed", () => {
    const b = finalsBracket(
      8,
      seeds(8),
      scorer({
        ...week1,
        "S1-S5": [10, 30], // SF1: minor premier knocked out
        "S3-S7": [10, 30], // SF2
        "S4-S7": [25, 20], // PF1
        "S2-S5": [10, 20], // PF2
        "S4-S5": [18, 18], // GF, drawn
      }),
    );
    expect(pairs(b.games, 4)).toEqual(["GF:S4vS5"]);
    expect(b.champion).toBe("S4");
  });

  it("needs exactly the right number of seeds", () => {
    expect(() => finalsBracket(8, seeds(6), () => null)).toThrow();
  });
});
