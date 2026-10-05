import { describe, expect, it } from "vitest";
import { DEFAULT_SCORING, type ScoringRules } from "@nrl/shared";
import { playerPoints, pointsBreakdown } from "./playerPoints.ts";

// The original six-stat scoring, fixed here so tests don't move with the default.
const SIX: ScoringRules = { runMetres: 0.1, tackles: 1, tries: 6, tryAssists: 4, goals: 2, errors: -4 };

describe("playerPoints", () => {
  it("scores Tabuai-Fidow's 2026 R5 game", () => {
    // 213m (21.3) + 10 tackles (10) + 2 tries (12) + 2 errors (-8)
    expect(playerPoints({ runMetres: 213, tackles: 10, tries: 2, errors: 2 }, SIX)).toBe(35.3);
  });

  it("uses the default (recommended) scoring", () => {
    // 21.3 + 10 x 0.25 + 2 x 8 - 8
    expect(playerPoints({ runMetres: 213, tackles: 10, tries: 2, errors: 2 }, DEFAULT_SCORING)).toBe(31.8);
  });

  it("scores any catalogue stat the rules give a value to", () => {
    const rules: ScoringRules = { lineBreaks: 3, sinBins: -5 };
    expect(playerPoints({ lineBreaks: 2, sinBins: 1, tries: 3 }, rules)).toBe(1);
  });

  it("treats missing stats as 0", () => {
    expect(playerPoints({}, SIX)).toBe(0);
    expect(playerPoints({ goals: 8 }, SIX)).toBe(16);
  });

  it("can go negative", () => {
    expect(playerPoints({ errors: 3, runMetres: 5 }, SIX)).toBe(-11.5);
  });

  it("avoids float noise", () => {
    expect(playerPoints({ runMetres: 7 }, SIX)).toBe(0.7);
    expect(playerPoints({ runMetres: 3 }, SIX)).toBe(0.3);
  });
});

describe("pointsBreakdown", () => {
  it("lists only stats that scored", () => {
    expect(pointsBreakdown({ tries: 1, errors: 1, lineBreaks: 4 }, SIX)).toEqual([
      { stat: "tries", value: 1, points: 6 },
      { stat: "errors", value: 1, points: -4 },
    ]);
  });
});
