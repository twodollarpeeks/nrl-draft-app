import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAGUE_SETTINGS,
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

  it("rejects league sizes outside 4-12", () => {
    for (const teamCount of [3, 13]) {
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
  it("puts top-4 finals in the last two rounds, ending at the chosen grand final", () => {
    expect(seasonRounds(27, DEFAULT_LEAGUE_SETTINGS.matchups)).toEqual({ lastRegularRound: 25, semiFinalRound: 26, grandFinalRound: 27 });
    expect(seasonRounds(24, DEFAULT_LEAGUE_SETTINGS.matchups)).toEqual({ lastRegularRound: 22, semiFinalRound: 23, grandFinalRound: 24 });
  });

  it("ends the regular season at the chosen round without finals", () => {
    expect(seasonRounds(25, { mode: "totalPoints" })).toEqual({ lastRegularRound: 25, semiFinalRound: null, grandFinalRound: null });
    expect(seasonRounds(25, { mode: "headToHead", finalsTeams: 0, tiebreakers: [] }).lastRegularRound).toBe(25);
  });
});
