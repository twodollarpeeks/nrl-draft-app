import { describe, expect, it } from "vitest";
import { DEFAULT_SCORING } from "@nrl/shared";
import { playerPoints, pointsBreakdown, type StatLine } from "./playerPoints.ts";

const zero: StatLine = { runMetres: 0, tackles: 0, tries: 0, tryAssists: 0, goals: 0, errors: 0 };

describe("playerPoints (default scoring)", () => {
  it("scores Tabuai-Fidow's 2026 R5 game", () => {
    // 213m (21.3) + 10 tackles (10) + 2 tries (12) + 2 errors (-8)
    const stats = { ...zero, runMetres: 213, tackles: 10, tries: 2, errors: 2 };
    expect(playerPoints(stats, DEFAULT_SCORING)).toBe(35.3);
  });

  it("scores goals at 2 each", () => {
    expect(playerPoints({ ...zero, goals: 8 }, DEFAULT_SCORING)).toBe(16);
  });

  it("can go negative", () => {
    expect(playerPoints({ ...zero, errors: 3, runMetres: 5 }, DEFAULT_SCORING)).toBe(-11.5);
  });

  it("uses the league's own values", () => {
    const rules = { ...DEFAULT_SCORING, tries: 4, runMetres: 0 };
    expect(playerPoints({ ...zero, tries: 1, runMetres: 100 }, rules)).toBe(4);
  });

  it("avoids float noise", () => {
    expect(playerPoints({ ...zero, runMetres: 7 }, DEFAULT_SCORING)).toBe(0.7);
    expect(playerPoints({ ...zero, runMetres: 3 }, DEFAULT_SCORING)).toBe(0.3);
  });
});

describe("pointsBreakdown", () => {
  it("lists only stats that scored", () => {
    expect(pointsBreakdown({ ...zero, tries: 1, errors: 1 }, DEFAULT_SCORING)).toEqual([
      { stat: "tries", value: 1, points: 6 },
      { stat: "errors", value: 1, points: -4 },
    ]);
  });
});
