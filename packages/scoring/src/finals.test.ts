import { describe, expect, it } from "vitest";
import { topFourBracket } from "./finals.ts";

describe("topFourBracket", () => {
  const seeds = ["S1", "S2", "S3", "S4"] as const;

  it("pairs 1v4 and 2v3 with nothing decided yet", () => {
    const b = topFourBracket(seeds, () => null);
    expect(b.semis.map((s) => [s.home, s.away])).toEqual([["S1", "S4"], ["S2", "S3"]]);
    expect(b.grandFinal).toMatchObject({ home: null, away: null, winner: null });
    expect(b.champion).toBeNull();
  });

  it("advances semi winners and crowns a champion", () => {
    const scores: Record<string, [number, number]> = {
      "S1-S4": [80, 90], // upset
      "S2-S3": [100, 70],
      "S2-S4": [61, 60],
    };
    const b = topFourBracket(seeds, (a, c) => scores[`${a}-${c}`] ?? null);
    expect(b.semis.map((s) => s.winner)).toEqual(["S4", "S2"]);
    // Higher seed (S2) is listed first in the grand final.
    expect(b.grandFinal).toMatchObject({ home: "S2", away: "S4" });
    expect(b.champion).toBe("S2");
  });

  it("a drawn final goes to the higher seed", () => {
    const b = topFourBracket(seeds, (a, c) => (a === "S2" && c === "S3" ? [50, 50] : null));
    expect(b.semis[1].winner).toBe("S2");
  });

  it("a drawn grand final goes to the higher seed, even after an upset", () => {
    const scores: Record<string, [number, number]> = {
      "S1-S4": [0, 10], "S2-S3": [0, 10], "S3-S4": [70, 70],
    };
    const b = topFourBracket(seeds, (a, c) => scores[`${a}-${c}`] ?? null);
    expect(b.grandFinal).toMatchObject({ home: "S3", away: "S4" });
    expect(b.champion).toBe("S3");
  });
});

