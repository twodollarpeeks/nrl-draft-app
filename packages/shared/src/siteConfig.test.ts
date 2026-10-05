import { describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE_SETTINGS, type LeagueSettings } from "./leagueSettings.ts";
import { DEFAULT_SITE_CONFIG, SiteConfig, applyCommissionerLimits } from "./siteConfig.ts";

const base: LeagueSettings = { ...DEFAULT_LEAGUE_SETTINGS, scoring: { tries: 8, tackles: 0.25, errors: -4 } };
const wanted: LeagueSettings = {
  ...DEFAULT_LEAGUE_SETTINGS,
  teamCount: 10,
  scoring: { tries: 5, tackles: 1, lineBreaks: 3 },
  draft: { type: "snake", pickSeconds: 120 },
  matchups: { mode: "totalPoints" },
  roster: { ...DEFAULT_LEAGUE_SETTINGS.roster, benchSize: 3 },
};

describe("applyCommissionerLimits", () => {
  it("lets everything through when everything is allowed", () => {
    expect(applyCommissionerLimits(wanted, base, DEFAULT_SITE_CONFIG)).toEqual(wanted);
  });

  it("keeps the base for sections commissioners can't change, but always allows league size", () => {
    const config: SiteConfig = {
      ...DEFAULT_SITE_CONFIG,
      commissionerCan: { scoring: false, roster: false, draftTimer: false, format: false },
    };
    expect(applyCommissionerLimits(wanted, base, config)).toEqual({ ...base, teamCount: 10 });
  });

  it("fixes locked stats at the base value, and lets allowed stats change", () => {
    const config: SiteConfig = { ...DEFAULT_SITE_CONFIG, commissionerStats: ["tries", "lineBreaks"] };
    expect(applyCommissionerLimits(wanted, base, config).scoring).toEqual({
      tries: 5, // allowed: commissioner's value
      lineBreaks: 3, // allowed: commissioner added it
      tackles: 0.25, // locked: stays at base, ignoring their 1
      errors: -4, // locked: stays at base, even though they dropped it
    });
  });

  it("validates as a site config", () => {
    expect(SiteConfig.safeParse(DEFAULT_SITE_CONFIG).success).toBe(true);
    expect(SiteConfig.safeParse({ ...DEFAULT_SITE_CONFIG, commissionerStats: ["nope"] }).success).toBe(false);
  });
});
