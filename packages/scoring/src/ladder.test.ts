import { describe, expect, it } from "vitest";
import { DEFAULT_MATCHUPS } from "@nrl/shared";
import { headToHeadLadder, totalPointsLadder, type MatchResult } from "./ladder.ts";

const TB = DEFAULT_MATCHUPS.mode === "headToHead" ? DEFAULT_MATCHUPS.tiebreakers : [];
const g = (home: string, away: string, homePoints: number, awayPoints: number): MatchResult<string> => ({
  home, away, homePoints, awayPoints,
});
const order = (rows: { team: string }[]) => rows.map((r) => r.team);

describe("headToHeadLadder", () => {
  it("ranks on wins and tallies the table", () => {
    const rows = headToHeadLadder(["A", "B", "C", "D"], [g("A", "B", 100, 90), g("C", "D", 80, 70), g("A", "C", 60, 50)], TB);
    expect(order(rows)).toEqual(["A", "C", "B", "D"]);
    expect(rows[0]).toMatchObject({ played: 2, wins: 2, losses: 0, pointsFor: 160, pointsAgainst: 140 });
  });

  it("counts a draw as half a win", () => {
    const rows = headToHeadLadder(["A", "B", "C"], [g("A", "B", 50, 50), g("C", "B", 40, 41)], TB);
    expect(rows.find((r) => r.team === "A")).toMatchObject({ draws: 1, winScore: 0.5 });
    expect(order(rows)).toEqual(["B", "A", "C"]); // B 1.5, A 0.5, C 0
  });

  it("breaks equal wins on points for first", () => {
    const rows = headToHeadLadder(["A", "B", "C", "D"], [g("A", "C", 100, 0), g("B", "D", 120, 0)], TB);
    expect(order(rows).slice(0, 2)).toEqual(["B", "A"]);
  });

  it("falls through a 3-way head-to-head tie to points against", () => {
    // A beat B, B beat C, C beat A: 1 win and 150 points for each, H2H 1-1-1.
    // Points against: A 160, B 140, C 150.
    const rows = headToHeadLadder(
      ["A", "B", "C"],
      [g("A", "B", 80, 70), g("B", "C", 80, 60), g("C", "A", 90, 70)],
      TB,
    );
    expect(order(rows)).toEqual(["B", "C", "A"]);
  });

  it("head-to-head decides a two-way tie", () => {
    const rows = headToHeadLadder(
      ["A", "B", "C", "D"],
      [g("A", "B", 50, 60), g("A", "C", 110, 0), g("B", "D", 0, 10), g("C", "D", 0, 50)],
      ["headToHead", "pointsFor"],
    );
    // A and B: 1 win each. B beat A.
    const ab = order(rows).filter((t) => t === "A" || t === "B");
    expect(ab).toEqual(["B", "A"]);
  });

  it("fewer points against ranks higher", () => {
    const rows = headToHeadLadder(["A", "B"], [g("A", "B", 50, 50)], ["pointsAgainst"]);
    expect(order(rows)).toEqual(["A", "B"]); // fully tied: input order
    const rows2 = headToHeadLadder(["A", "B", "C", "D"], [g("A", "C", 50, 40), g("B", "D", 50, 10)], ["pointsAgainst"]);
    expect(order(rows2).slice(0, 2)).toEqual(["B", "A"]);
  });

  it("rejects results for unknown teams", () => {
    expect(() => headToHeadLadder(["A"], [g("A", "Z", 1, 0)], TB)).toThrow();
  });
});

describe("totalPointsLadder", () => {
  it("ranks on total points across rounds", () => {
    const rows = totalPointsLadder(["A", "B"], [
      { team: "A", points: 50.5 }, { team: "B", points: 60 }, { team: "A", points: 20.2 },
    ]);
    expect(rows).toEqual([{ team: "A", pointsFor: 70.7 }, { team: "B", pointsFor: 60 }]);
  });
});
