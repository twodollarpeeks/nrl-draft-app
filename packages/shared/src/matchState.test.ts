import { describe, expect, it } from "vitest";
import { matchScoreState } from "./matchState.ts";

const kickoff = new Date("2027-03-05T09:00:00Z");
const at = (hours: number) => new Date(kickoff.getTime() + hours * 3_600_000);

describe("matchScoreState", () => {
  it("is upcoming before kickoff and live until full time", () => {
    expect(matchScoreState({ kickoffAt: kickoff, state: "Upcoming" }, at(-1))).toBe("upcoming");
    expect(matchScoreState({ kickoffAt: kickoff, state: "SecondHalf" }, at(1))).toBe("live");
  });

  it("is in review for 24 hours after full time, then final", () => {
    expect(matchScoreState({ kickoffAt: kickoff, state: "FullTime" }, at(2))).toBe("review");
    expect(matchScoreState({ kickoffAt: kickoff, state: "FullTime" }, at(25.9))).toBe("review");
    expect(matchScoreState({ kickoffAt: kickoff, state: "FullTime" }, at(26))).toBe("final");
  });

  it("stays live if nrl.com hasn't marked full time yet", () => {
    expect(matchScoreState({ kickoffAt: kickoff, state: "SecondHalf" }, at(30))).toBe("live");
  });
});
