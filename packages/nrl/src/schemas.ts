import { z } from "zod";

// Only the fields we use. Unknown fields are ignored, so nrl.com adding fields
// doesn't break imports; removing or renaming one we rely on fails loudly.

const Theme = z.object({ key: z.string() });

const DrawTeam = z.object({
  teamId: z.number().int(),
  nickName: z.string(),
  score: z.number().int().optional(),
  theme: Theme,
});

export const DrawFixture = z.object({
  type: z.literal("Match"),
  roundTitle: z.string(),
  matchState: z.string(),
  venue: z.string().optional(),
  matchCentreUrl: z.string(),
  homeTeam: DrawTeam,
  awayTeam: DrawTeam,
  clock: z.object({ kickOffTimeLong: z.string() }),
});
export type DrawFixture = z.infer<typeof DrawFixture>;

export const DrawBye = z.object({
  type: z.literal("Bye"),
  teamNickName: z.string(),
  theme: Theme,
});

export const DrawPage = z.object({
  fixtures: z.array(z.unknown()),
  byes: z.array(z.unknown()).default([]),
  selectedSeasonId: z.number().int(),
  selectedRoundId: z.number().int(),
  filterRounds: z.array(z.object({ name: z.string(), value: z.number().int() })),
});
export type DrawPage = z.infer<typeof DrawPage>;

const MatchPlayer = z.object({
  playerId: z.number().int(),
  firstName: z.string(),
  lastName: z.string(),
  position: z.string(),
  number: z.number().int(),
  url: z.string().optional(),
  headImage: z.string().optional(),
});
export type MatchPlayer = z.infer<typeof MatchPlayer>;

const MatchTeam = z.object({
  teamId: z.number().int(),
  nickName: z.string(),
  name: z.string().optional(),
  score: z.number().int().optional(),
  theme: Theme,
  players: z.array(MatchPlayer).default([]),
});

// Every stat is a number; we keep the whole record and pick a few by name.
export const PlayerStatLine = z
  .object({
    playerId: z.number().int(),
    minutesPlayed: z.number(),
    allRunMetres: z.number(),
    tacklesMade: z.number(),
    tries: z.number(),
    tryAssists: z.number(),
    // nrl.com's own "goals" field is always 0; goals = conversions + penaltyGoals.
    conversions: z.number(),
    penaltyGoals: z.number(),
    errors: z.number(),
  })
  .catchall(z.unknown());
export type PlayerStatLine = z.infer<typeof PlayerStatLine>;

export const MatchCentre = z.object({
  match: z.object({
    matchId: z.string(),
    matchState: z.string(),
    updated: z.string().optional(),
    roundNumber: z.number().int(),
    roundTitle: z.string(),
    startTime: z.string(),
    url: z.string(),
    venue: z.string().optional(),
    homeTeam: MatchTeam,
    awayTeam: MatchTeam,
    stats: z
      .object({
        players: z
          .object({
            homeTeam: z.array(PlayerStatLine).default([]),
            awayTeam: z.array(PlayerStatLine).default([]),
          })
          .optional(),
      })
      .optional(),
  }),
});
export type MatchCentre = z.infer<typeof MatchCentre>;
