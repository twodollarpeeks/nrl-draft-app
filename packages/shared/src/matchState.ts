// When a game's fantasy points can be trusted. nrl.com keeps correcting stats
// after full time, so scores stay "in review" for a while before they're final.

/** How long stats stay in review after full time. */
export const STATS_REVIEW_HOURS = 24;
/** Full time is taken as this long after kickoff (we don't get the exact time). */
export const MATCH_LENGTH_HOURS = 2;

export type ScoreState = "upcoming" | "live" | "review" | "final";

const HOUR = 3_600_000;

export function matchScoreState(match: { kickoffAt: Date; state: string }, now: Date): ScoreState {
  if (match.kickoffAt > now) return "upcoming";
  if (match.state !== "FullTime") return "live";
  const finalAt = match.kickoffAt.getTime() + (MATCH_LENGTH_HOURS + STATS_REVIEW_HOURS) * HOUR;
  return now.getTime() >= finalAt ? "final" : "review";
}
