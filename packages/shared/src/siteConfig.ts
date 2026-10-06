import { z } from "zod";
import {
  DEFAULT_LEAGUE_SETTINGS,
  DEFAULT_SCORING,
  SCORING_STATS,
  ScoringRules,
  ScoringStat,
  type LeagueSettings,
} from "./leagueSettings.ts";
import type { NrlPosition } from "./positions.ts";

// Site-wide settings, edited by site admins: the scoring new leagues start
// with, and which league settings commissioners are allowed to change.

export const CommissionerPermissions = z.object({
  /** Change the points for (some) stats. Which ones: `commissionerStats`. */
  scoring: z.boolean(),
  /** Change the squad structure (slot counts, bench size). */
  roster: z.boolean(),
  /** Change the pick timer. */
  draftTimer: z.boolean(),
  /** Change head-to-head / finals / total points. */
  format: z.boolean(),
});
export type CommissionerPermissions = z.infer<typeof CommissionerPermissions>;

export const SiteConfig = z.object({
  defaultScoring: ScoringRules,
  commissionerCan: CommissionerPermissions,
  /** Stats whose points commissioners may change; the rest stay at the default. */
  commissionerStats: z.array(ScoringStat),
});
export type SiteConfig = z.infer<typeof SiteConfig>;

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  defaultScoring: DEFAULT_SCORING,
  commissionerCan: { scoring: true, roster: true, draftTimer: true, format: true },
  commissionerStats: [...SCORING_STATS],
};

/** What a commissioner may change, as the create/settings forms need it. */
export interface LeagueDefaults {
  settings: LeagueSettings;
  commissionerCan: CommissionerPermissions;
  commissionerStats: ScoringStat[];
}

export function leagueDefaults(config: SiteConfig): LeagueDefaults {
  return {
    settings: { ...DEFAULT_LEAGUE_SETTINGS, scoring: config.defaultScoring },
    commissionerCan: config.commissionerCan,
    commissionerStats: config.commissionerStats,
  };
}

/**
 * Apply the site's limits to settings a commissioner asked for. Anything
 * they're not allowed to change comes from `base`: the site defaults for a
 * new league, or the league's current settings for an edit. League size is
 * always theirs to set.
 */
export function applyCommissionerLimits(wanted: LeagueSettings, base: LeagueSettings, config: SiteConfig): LeagueSettings {
  const can = config.commissionerCan;
  let scoring: ScoringRules = base.scoring;
  if (can.scoring) {
    const allowed = new Set(config.commissionerStats);
    scoring = {};
    for (const stat of SCORING_STATS) {
      const value = allowed.has(stat) ? wanted.scoring[stat] : base.scoring[stat];
      if (value) scoring[stat] = value;
    }
  }
  return {
    teamCount: wanted.teamCount,
    roster: can.roster ? wanted.roster : base.roster,
    draft: can.draftTimer ? wanted.draft : base.draft,
    matchups: can.format ? wanted.matchups : base.matchups,
    seasonEndRound: can.format ? wanted.seasonEndRound : base.seasonEndRound,
    scoring,
  };
}

// ---- Admin preview -----------------------------------------------------------

export const PreviewScoringInput = z.object({ scoring: ScoringRules });

export interface ScoringPreviewGroup {
  /** Position group: forwards, outside backs, halves & hookers. */
  group: "FWD" | "OB" | "HBHK";
  label: string;
  /** How many of this group an 8-team league starts. */
  starters: number;
  /** Average of the last starter at this group (e.g. the 24th-best forward). */
  starterLevel: number;
  best: { name: string; avgPoints: number } | null;
}

export interface ScoringPreview {
  season: number;
  /** Largest starter level / smallest. 1.00 = perfectly even. */
  spread: number;
  groups: ScoringPreviewGroup[];
  top: Array<{ rank: number; name: string; club: string | null; positions: NrlPosition[]; avgPoints: number; games: number }>;
}
