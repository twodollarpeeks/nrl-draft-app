// Pure functions: nrl.com page JSON -> the rows we store. No I/O here, so it's
// all unit-testable against saved pages.

import { positionFromLabel } from "./positions.ts";
import {
  DrawBye,
  DrawFixture,
  DrawPage,
  MatchCentre,
  type PlayerStatLine,
} from "./schemas.ts";
import { findQData } from "./qdata.ts";

export const COMPETITION_ID = 111; // NRL Telstra Premiership
export const LAST_REGULAR_ROUND = 27;

export function drawUrl(season: number, round: number): string {
  return `/draw/?competition=${COMPETITION_ID}&round=${round}&season=${season}`;
}

/** Without season/round, nrl.com's draw shows the current round. */
export const CURRENT_DRAW_URL = `/draw/?competition=${COMPETITION_ID}`;

export function parseCurrentRound(html: string): { season: number; round: number } {
  const page = DrawPage.parse(findQData(html, "fixtures"));
  return { season: page.selectedSeasonId, round: page.selectedRoundId };
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export interface ClubRow {
  id: number;
  key: string;
  nickName: string;
  name?: string;
}

export interface RoundRow {
  season: number;
  number: number;
  title: string;
  slug: string;
  isFinals: boolean;
  byeClubKeys: string[];
}

export interface MatchRow {
  id?: string; // only known once the match page is fetched
  url: string; // path, e.g. /draw/nrl-premiership/2026/round-5/dolphins-v-sea-eagles/
  homeClubId: number;
  awayClubId: number;
  kickoffAt: Date;
  venue: string | null;
  state: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface ParsedDraw {
  round: RoundRow;
  clubs: ClubRow[];
  matches: MatchRow[];
  rawJson: unknown;
}

/**
 * Parse a draw page. Returns null if nrl.com served a different season/round
 * than requested (it falls back to the current round for ones that don't exist).
 */
export function parseDraw(html: string, season: number, round: number): ParsedDraw | null {
  const rawJson = findQData(html, "fixtures");
  const page = DrawPage.parse(rawJson);
  if (page.selectedSeasonId !== season || page.selectedRoundId !== round) return null;

  const fixtures = page.fixtures
    .filter((f) => (f as { type?: string }).type === "Match")
    .map((f) => DrawFixture.parse(f));
  const byes = page.byes
    .filter((b) => (b as { type?: string }).type === "Bye")
    .map((b) => DrawBye.parse(b));

  const title =
    page.filterRounds.find((r) => r.value === round)?.name ??
    fixtures[0]?.roundTitle ??
    `Round ${round}`;

  const clubs = new Map<number, ClubRow>();
  for (const f of fixtures) {
    for (const t of [f.homeTeam, f.awayTeam]) {
      clubs.set(t.teamId, { id: t.teamId, key: t.theme.key, nickName: t.nickName });
    }
  }

  return {
    round: {
      season,
      number: round,
      title,
      slug: slugify(title),
      isFinals: round > LAST_REGULAR_ROUND,
      byeClubKeys: byes.map((b) => b.theme.key),
    },
    clubs: [...clubs.values()],
    matches: fixtures.map((f) => ({
      url: urlPath(f.matchCentreUrl),
      homeClubId: f.homeTeam.teamId,
      awayClubId: f.awayTeam.teamId,
      kickoffAt: new Date(f.clock.kickOffTimeLong),
      venue: f.venue ?? null,
      state: f.matchState,
      homeScore: f.homeTeam.score ?? null,
      awayScore: f.awayTeam.score ?? null,
    })),
    rawJson,
  };
}

export interface PlayerRow {
  id: number;
  firstName: string;
  lastName: string;
  profileUrl: string | null;
  headImage: string | null;
}

export interface AppearanceRow {
  playerId: number;
  clubId: number;
  jersey: number;
  positionLabel: string;
  isStarter: boolean;
  minutes: number | null;
  runMetres: number | null;
  tackles: number | null;
  tries: number | null;
  tryAssists: number | null;
  goals: number | null;
  errors: number | null;
  stats: PlayerStatLine | null;
}

export interface ParsedMatch {
  match: MatchRow & { id: string; sourceUpdatedAt: Date | null };
  clubs: ClubRow[];
  players: PlayerRow[];
  appearances: AppearanceRow[];
  rawJson: unknown;
}

export function parseMatch(html: string): ParsedMatch {
  const rawJson = findQData(html, "match");
  const { match: m } = MatchCentre.parse(rawJson);
  const statSides = m.stats?.players;

  const players: PlayerRow[] = [];
  const appearances: AppearanceRow[] = [];

  for (const [team, stats] of [
    [m.homeTeam, statSides?.homeTeam ?? []],
    [m.awayTeam, statSides?.awayTeam ?? []],
  ] as const) {
    const statsById = new Map(stats.map((s) => [s.playerId, s]));
    for (const p of team.players) {
      players.push({
        id: p.playerId,
        firstName: p.firstName,
        lastName: p.lastName,
        profileUrl: p.url ?? null,
        headImage: p.headImage ? absoluteUrl(p.headImage) : null,
      });
      const s = statsById.get(p.playerId) ?? null;
      appearances.push({
        playerId: p.playerId,
        clubId: team.teamId,
        jersey: p.number,
        positionLabel: p.position,
        isStarter: p.number <= 13 && positionFromLabel(p.position) !== null,
        minutes: s ? Math.round(s.minutesPlayed) : null,
        runMetres: s ? Math.round(s.allRunMetres) : null,
        tackles: s ? s.tacklesMade : null,
        tries: s ? s.tries : null,
        tryAssists: s ? s.tryAssists : null,
        goals: s ? s.conversions + s.penaltyGoals : null,
        errors: s ? s.errors : null,
        stats: s,
      });
    }
  }

  return {
    match: {
      id: m.matchId,
      url: urlPath(m.url),
      homeClubId: m.homeTeam.teamId,
      awayClubId: m.awayTeam.teamId,
      kickoffAt: new Date(m.startTime),
      venue: m.venue ?? null,
      state: m.matchState,
      homeScore: m.homeTeam.score ?? null,
      awayScore: m.awayTeam.score ?? null,
      sourceUpdatedAt: m.updated ? new Date(m.updated) : null,
    },
    clubs: [m.homeTeam, m.awayTeam].map((t) => ({
      id: t.teamId,
      key: t.theme.key,
      nickName: t.nickName,
      name: t.name,
    })),
    players,
    appearances,
    rawJson,
  };
}

/** nrl.com player profile path, from the club-site URL in match data. */
export function profilePath(clubKey: string, profileUrl: string): string | null {
  const slug = profileUrl.replace(/\/+$/, "").split("/").pop();
  return slug ? `/players/nrl-premiership/${clubKey}/${slug}/` : null;
}

function urlPath(url: string): string {
  return url.startsWith("http") ? new URL(url).pathname : url;
}

function absoluteUrl(path: string): string {
  return path.startsWith("http") ? path : `https://www.nrl.com${path}`;
}
