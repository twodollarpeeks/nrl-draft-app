import { z } from "zod";
import { NRL_POSITIONS, NrlPosition } from "./positions.ts";

// ---- Roster template ------------------------------------------------------

// A starting slot type, e.g. "3x FWD, eligible: FRF/2RF/LK". Bench slots are
// separate (benchSize) and accept any position.
export const RosterSlot = z.object({
  key: z.string().regex(/^[A-Z0-9_]{1,12}$/),
  label: z.string().min(1).max(24),
  count: z.number().int().min(1).max(6),
  eligible: z.array(NrlPosition).min(1),
});
export type RosterSlot = z.infer<typeof RosterSlot>;

export const RosterTemplate = z
  .object({
    slots: z.array(RosterSlot).min(1).max(12),
    benchSize: z.number().int().min(0).max(10),
  })
  .refine((t) => new Set(t.slots.map((s) => s.key)).size === t.slots.length, {
    message: "Slot keys must be unique",
  })
  .refine((t) => starterCount(t) + t.benchSize <= 30, {
    message: "Squad can have at most 30 players",
  });
export type RosterTemplate = z.infer<typeof RosterTemplate>;

export function starterCount(t: { slots: readonly { count: number }[] }): number {
  return t.slots.reduce((n, s) => n + s.count, 0);
}

export function squadSize(t: RosterTemplate): number {
  return starterCount(t) + t.benchSize;
}

export const DEFAULT_ROSTER_TEMPLATE: RosterTemplate = {
  slots: [
    { key: "HB_HK", label: "HB/HK", count: 1, eligible: ["HB", "FE", "HK"] },
    { key: "FWD", label: "Forward", count: 3, eligible: ["FRF", "2RF", "LK"] },
    { key: "OB", label: "Outside Back", count: 3, eligible: ["FB", "WG", "CE"] },
    { key: "FLEX", label: "Flex", count: 1, eligible: [...NRL_POSITIONS] },
  ],
  benchSize: 6,
};

// ---- Scoring ----------------------------------------------------------------

// The stats a league can put a value on. Values are points per unit (run
// metres are per metre, so 0.1 = 1 point per 10m).
export const SCORING_STATS = [
  "runMetres",
  "tackles",
  "tries",
  "tryAssists",
  "goals",
  "errors",
] as const;
export const ScoringStat = z.enum(SCORING_STATS);
export type ScoringStat = z.infer<typeof ScoringStat>;

export const SCORING_STAT_LABELS: Record<ScoringStat, string> = {
  runMetres: "Run metres (per metre)",
  tackles: "Tackles",
  tries: "Tries",
  tryAssists: "Try assists",
  goals: "Goals",
  errors: "Errors",
};

export const ScoringRules = z.record(
  ScoringStat,
  z.number().min(-50).max(50),
);
export type ScoringRules = z.infer<typeof ScoringRules>;

export const DEFAULT_SCORING: ScoringRules = {
  runMetres: 0.1,
  tackles: 1,
  tries: 6,
  tryAssists: 4,
  goals: 2,
  errors: -4,
};

// ---- Draft --------------------------------------------------------------------

export const DraftSettings = z.object({
  type: z.enum(["snake"]), // "auction" is post-MVP
  pickSeconds: z.number().int().min(15).max(60 * 60 * 24),
});
export type DraftSettings = z.infer<typeof DraftSettings>;

export const DEFAULT_DRAFT: DraftSettings = { type: "snake", pickSeconds: 60 };

// ---- Matchups & finals ----------------------------------------------------

export const Tiebreaker = z.enum(["pointsFor", "headToHead", "pointsAgainst"]);
export type Tiebreaker = z.infer<typeof Tiebreaker>;

export const MatchupSettings = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("headToHead"),
    finalsTeams: z.union([z.literal(0), z.literal(4)]),
    tiebreakers: z.array(Tiebreaker),
  }),
  z.object({ mode: z.literal("totalPoints") }),
]);
export type MatchupSettings = z.infer<typeof MatchupSettings>;

export const DEFAULT_MATCHUPS: MatchupSettings = {
  mode: "headToHead",
  finalsTeams: 4,
  tiebreakers: ["pointsFor", "headToHead", "pointsAgainst"],
};

// ---- Whole league -------------------------------------------------------------

export const MIN_TEAMS = 4;
export const MAX_TEAMS = 12;

export const LeagueSettings = z.object({
  teamCount: z.number().int().min(MIN_TEAMS).max(MAX_TEAMS),
  roster: RosterTemplate,
  scoring: ScoringRules,
  draft: DraftSettings,
  matchups: MatchupSettings,
});
export type LeagueSettings = z.infer<typeof LeagueSettings>;

export const DEFAULT_LEAGUE_SETTINGS: LeagueSettings = {
  teamCount: 8,
  roster: DEFAULT_ROSTER_TEMPLATE,
  scoring: DEFAULT_SCORING,
  draft: DEFAULT_DRAFT,
  matchups: DEFAULT_MATCHUPS,
};
