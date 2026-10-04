import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAGUE_SETTINGS,
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

  it("five-eighths fill the HB/HK slot, not OB", () => {
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
});
