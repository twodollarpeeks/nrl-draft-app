import { describe, expect, it } from "vitest";
import { roundRobin } from "./fixtures.ts";

const key = (a: string, b: string) => [a, b].sort().join("-");

describe("roundRobin", () => {
  for (const size of [4, 5, 8, 11, 12]) {
    describe(`${size} teams`, () => {
      const teams = Array.from({ length: size }, (_, i) => `T${i + 1}`);
      const cycle = size % 2 === 0 ? size - 1 : size;
      const schedule = roundRobin(teams, cycle * 2);

      it("nobody plays twice in a round", () => {
        for (const round of schedule) {
          const seen = round.flatMap((p) => [p.home, p.away]);
          expect(new Set(seen).size).toBe(seen.length);
          expect(round).toHaveLength(Math.floor(size / 2));
        }
      });

      it("everyone plays everyone exactly once per cycle", () => {
        const pairs = schedule.slice(0, cycle).flatMap((r) => r.map((p) => key(p.home, p.away)));
        expect(new Set(pairs).size).toBe(pairs.length);
        expect(pairs).toHaveLength((size * (size - 1)) / 2);
      });

      it("the second cycle swaps home and away", () => {
        const first = schedule.slice(0, cycle).flat().map((p) => `${p.home}>${p.away}`);
        const second = schedule.slice(cycle).flat().map((p) => `${p.away}>${p.home}`);
        expect(new Set(second)).toEqual(new Set(first));
      });
    });
  }

  it("odd team counts give each team one bye per cycle", () => {
    const teams = ["A", "B", "C", "D", "E"];
    const byes = roundRobin(teams, 5).map((round) => {
      const playing = new Set(round.flatMap((p) => [p.home, p.away]));
      return teams.filter((t) => !playing.has(t));
    });
    expect(byes.flat().sort()).toEqual(teams);
  });
});
