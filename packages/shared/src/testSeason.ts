/**
 * Test seasons: a real season's draw and stats replayed on today's calendar,
 * so a league can be tried out mid-season. A test season's number is the real
 * one minus 1000 (2026 plays as 1026), which keeps it clear of real seasons.
 */
export const TEST_SEASON_OFFSET = 1000;

export const testSeasonOf = (realSeason: number) => realSeason - TEST_SEASON_OFFSET;
export const isTestSeason = (season: number) => season < 2000;
export const realSeasonOf = (season: number) => (isTestSeason(season) ? season + TEST_SEASON_OFFSET : season);

/** "2026", or "2026 (test)" for a test season. */
export const seasonLabel = (season: number) => (isTestSeason(season) ? `${realSeasonOf(season)} (test)` : String(season));
