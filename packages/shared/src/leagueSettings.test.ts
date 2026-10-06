import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAGUE_SETTINGS,
  fitFinalsToTeams,
  seasonRounds,
  DEFAULT_ROSTER_TEMPLATE,
  LeagueSettings,
  RosterTemplate,
  squadSize,
  starterCount,
} from "./leagueSettings.ts";

describe("league settings", () => {
  it("default settings are valid", () => {
    expect(LeagueSettings.safeParse(DEFAULT_LEAGUE_SETTINGS).success).toBe(true);
  });

  it("default squad is 8 starters + 6 bench", () => {
    expect(starterCount(DEFAULT_ROSTER_TEMPLATE)).toBe(8);
    expect(squadSize(DEFAULT_ROSTER_TEMPLATE)).toBe(14);
  });

  it("five-eighths fill the HF/HK slot, not OB", () => {
    const slot = (key: string) =>
      DEFAULT_ROSTER_TEMPLATE.slots.find((s) => s.key === key)!;
    expect(slot("HB_HK").eligible).toContain("FE");
    expect(slot("OB").eligible).not.toContain("FE");
  });

  it("rejects duplicate slot keys", () => {
    const bad = {
      ...DEFAULT_ROSTER_TEMPLATE,
      slots: [...DEFAULT_ROSTER_TEMPLATE.slots, DEFAULT_ROSTER_TEMPLATE.slots[0]],
    };
    expect(RosterTemplate.safeParse(bad).success).toBe(false);
  });

  it("rejects league sizes outside 4-18", () => {
    for (const teamCount of [3, 19]) {
      const r = LeagueSettings.safeParse({ ...DEFAULT_LEAGUE_SETTINGS, teamCount });
      expect(r.success).toBe(false);
    }
  });

  it("old leagues without a season end run the full NRL season", () => {
    const { seasonEndRound: _drop, ...old } = DEFAULT_LEAGUE_SETTINGS;
    expect(LeagueSettings.parse(old).seasonEndRound).toBe(27);
  });

  it("only allows season ends between rounds 12 and 27", () => {
    for (const r of [11, 28]) {
      expect(LeagueSettings.safeParse({ ...DEFAULT_LEAGUE_SETTINGS, seasonEndRound: r }).success).toBe(false);
    }
  });
});

describe("seasonRounds", () => {
  const h2h = (finalsTeams: 0 | 4 | 6 | 8) => ({ mode: "headToHead" as const, finalsTeams, tiebreakers: [] });

  it("ends the regular season before the finals weeks, with the grand final at the chosen round", () => {
    expect(seasonRounds(27, h2h(4))).toEqual({ lastRegularRound: 25, finalsStartRound: 26, grandFinalRound: 27, finalsWeeks: 2 });
    expect(seasonRounds(24, h2h(6))).toEqual({ lastRegularRound: 21, finalsStartRound: 22, grandFinalRound: 24, finalsWeeks: 3 });
    expect(seasonRounds(27, h2h(8))).toEqual({ lastRegularRound: 23, finalsStartRound: 24, grandFinalRound: 27, finalsWeeks: 4 });
  });

  it("ends at the chosen round without finals", () => {
    expect(seasonRounds(25, { mode: "totalPoints" })).toMatchObject({ lastRegularRound: 25, finalsStartRound: null, grandFinalRound: null });
    expect(seasonRounds(25, h2h(0)).lastRegularRound).toBe(25);
  });
});

describe("finals size", () => {
  it("can't exceed the number of teams", () => {
    const s = { ...DEFAULT_LEAGUE_SETTINGS, teamCount: 6, matchups: { mode: "headToHead" as const, finalsTeams: 8 as const, tiebreakers: [] } };
    expect(LeagueSettings.safeParse(s).success).toBe(false);
    expect(LeagueSettings.safeParse({ ...s, teamCount: 8 }).success).toBe(true);
  });

  it("shrinks to the biggest format that fits", () => {
    expect(fitFinalsToTeams(8, 10)).toBe(8);
    expect(fitFinalsToTeams(8, 7)).toBe(6);
    expect(fitFinalsToTeams(6, 5)).toBe(4);
    expect(fitFinalsToTeams(4, 3)).toBe(0);
  });

  it("allows leagues of up to 18 teams", () => {
    expect(LeagueSettings.safeParse({ ...DEFAULT_LEAGUE_SETTINGS, teamCount: 18 }).success).toBe(true);
    expect(LeagueSettings.safeParse({ ...DEFAULT_LEAGUE_SETTINGS, teamCount: 19 }).success).toBe(false);
  });
});

describe("positionGroup", async () => {
  const { positionGroup } = await import("./positions.ts");
  it("groups by the first-listed position", () => {
    expect(positionGroup(["FE"])).toBe("half");
    expect(positionGroup(["LK", "HK"])).toBe("fwd");
    expect(positionGroup(["CE", "2RF"])).toBe("ob");
    expect(positionGroup([])).toBeNull();
  });
});
