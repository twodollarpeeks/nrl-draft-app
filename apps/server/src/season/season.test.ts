import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE_SETTINGS, type LeagueSettings, type RoundView, type SeasonOverview, type TeamRoundView } from "@nrl/shared";
import { createUser, hasTestDb, resetDb, testDb } from "../../../../test/db.ts";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { firstFantasyRound, startSeason } from "./setup.ts";

// A 4-team league over a 12-round season: regular rounds 1-10, then top-4
// finals (semis round 11, grand final round 12). Squads are 4 players:
// HF/HK, FWD, OB and one on the bench. Scoring: 10 points a try.
const SETTINGS: LeagueSettings = {
  ...DEFAULT_LEAGUE_SETTINGS,
  teamCount: 4,
  roster: {
    slots: [
      { key: "HB_HK", label: "HF/HK", count: 1, eligible: ["HB", "FE", "HK"] },
      { key: "FWD", label: "Forward", count: 1, eligible: ["FRF", "2RF", "LK"] },
      { key: "OB", label: "Outside Back", count: 1, eligible: ["FB", "WG", "CE"] },
    ],
    benchSize: 1,
  },
  scoring: { tries: 10 },
  matchups: { mode: "headToHead", finalsTeams: 4, tiebreakers: ["pointsFor", "headToHead", "pointsAgainst"] },
  seasonEndRound: 12,
};

const DAY = 86_400_000;
const SEASON_START = new Date("2027-03-04T09:00:00Z").getTime();
const kickoff = (round: number) => new Date(SEASON_START + (round - 1) * 7 * DAY);

// Clubs: Alpha (1) and Bravo (2) play each other every round; Charlie (3) always has a bye.
// Team t's players in draft order: HB (Alpha), FRF (Bravo), then for team 0 a
// Charlie centre and an Alpha winger (so the centre's bye brings the winger in);
// for other teams an Alpha winger then a Charlie centre on the bench.
function squad(t: number) {
  const base = t * 10;
  const ob = t === 0 ? [{ id: base + 3, pos: "CE", club: 3 }, { id: base + 4, pos: "WG", club: 1 }] : [{ id: base + 3, pos: "WG", club: 1 }, { id: base + 4, pos: "CE", club: 3 }];
  return [{ id: base + 1, pos: "HB", club: 1 }, { id: base + 2, pos: "FRF", club: 2 }, ...ob];
}
const tries = (playerId: number, round: number) => (playerId + round) % 3;

describe.runIf(hasTestDb)("season play", () => {
  const db = testDb();
  let clock = kickoff(1);
  const appPromise = buildApp({
    env: loadEnv({ NODE_ENV: "test" }),
    db,
    season: { now: () => clock },
    getUser: async (req) => {
      const id = req.headers["x-test-user"];
      const u = typeof id === "string" ? await db.user.findUnique({ where: { id } }) : null;
      return u && { id: u.id, name: u.name, email: u.email, image: u.image };
    },
  });

  async function call<T = unknown>(userId: string, method: string, url: string, body?: unknown) {
    const res = await (await appPromise).inject({
      method: method as "GET",
      url,
      headers: { "x-test-user": userId },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    return { status: res.statusCode, body: res.json() as T };
  }

  let leagueId = "";
  let users: Array<{ id: string }> = [];
  let teamIds: string[] = [];

  /** Rounds up to `completed` are at full time with stats; later ones are upcoming. */
  async function seed(completed: number) {
    await db.club.createMany({
      data: [
        { id: 1, key: "alpha", nickName: "Alpha" },
        { id: 2, key: "bravo", nickName: "Bravo" },
        { id: 3, key: "charlie", nickName: "Charlie" },
      ],
    });
    for (let t = 0; t < 4; t++) {
      for (const p of squad(t)) {
        await db.player.create({ data: { id: p.id, firstName: "P", lastName: String(p.id), clubId: p.club, positions: [p.pos], positionsOverride: [] } });
      }
    }
    for (let r = 1; r <= 12; r++) {
      const round = await db.round.create({
        data: { season: 2027, number: r, title: `Round ${r}`, slug: `round-${r}`, byeClubKeys: ["charlie"] },
      });
      const done = r <= completed;
      await db.match.create({
        data: { id: `m${r}`, roundId: round.id, homeClubId: 1, awayClubId: 2, kickoffAt: kickoff(r), url: `/m${r}`, state: done ? "FullTime" : "Upcoming" },
      });
      if (!done) continue;
      for (let t = 0; t < 4; t++) {
        for (const p of squad(t).filter((x) => x.club !== 3)) {
          await db.appearance.create({
            data: {
              matchId: `m${r}`, playerId: p.id, clubId: p.club, jersey: 1, positionLabel: "x", isStarter: true,
              minutes: 80, stats: { tries: tries(p.id, r) },
            },
          });
        }
      }
    }
  }

  async function makeLeague() {
    users = [];
    for (let i = 0; i < 4; i++) users.push(await createUser(db, `Manager ${i}`));
    const created = await call<{ id: string; inviteCode: string }>(users[0]!.id, "POST", "/api/leagues", {
      name: "Season Test", season: 2027, settings: SETTINGS, draftOrderMode: "manual",
    });
    leagueId = created.body.id;
    for (const u of users.slice(1)) await call(u.id, "POST", `/api/invites/${created.body.inviteCode}/join`, {});
    const teams = await db.team.findMany({ where: { leagueId } });
    teamIds = users.map((u) => teams.find((t) => t.ownerId === u.id)!.id);
    // "Draft": team t gets squad(t), in that order.
    const draft = await db.draft.create({
      data: { leagueId, status: "complete", pickSeconds: 60, order: teamIds, totalPicks: 16, currentPick: 17 },
    });
    let pickNo = 0;
    for (let t = 0; t < 4; t++) {
      for (const p of squad(t)) {
        pickNo++;
        await db.draftPick.create({ data: { draftId: draft.id, pickNo, round: 1, teamId: teamIds[t]!, playerId: p.id, madeBy: "manager" } });
        await db.rosterEntry.create({ data: { leagueId, teamId: teamIds[t]!, playerId: p.id, acquiredVia: "draft" } });
      }
    }
    await db.league.update({ where: { id: leagueId }, data: { status: "inSeason" } });
    await db.$transaction((tx) => startSeason(tx, leagueId, teamIds, clock));
  }

  beforeEach(async () => {
    await resetDb(db);
  });
  afterAll(async () => {
    await (await appPromise).close();
    await db.$disconnect();
  });

  const teamRound = (u: number, t: number, r: number) =>
    call<TeamRoundView>(users[u]!.id, "GET", `/api/leagues/${leagueId}/teams/${teamIds[t]}/rounds/${r}`);

  /** Expected score for team t in a completed round: starters HB + FRF + OB scorer. */
  const expected = (t: number, r: number) => {
    const s = squad(t);
    const ob = t === 0 ? s[3]! : s[2]!; // team 0's centre is on a bye, so the winger comes in
    return 10 * (tries(s[0]!.id, r) + tries(s[1]!.id, r) + tries(ob.id, r));
  };

  describe("before the season", () => {
    beforeEach(async () => {
      clock = new Date(kickoff(1).getTime() - DAY);
      await seed(0);
      await makeLeague();
    });

    it("starts at round 1 and builds a round-robin fixture for the regular season", async () => {
      expect((await db.league.findUniqueOrThrow({ where: { id: leagueId } })).firstRound).toBe(1);
      const matchups = await db.matchup.findMany({ where: { leagueId } });
      expect(matchups).toHaveLength(20); // 10 rounds x 2 games
      for (let r = 1; r <= 10; r++) {
        const teams = matchups.filter((m) => m.round === r).flatMap((m) => [m.homeTeamId, m.awayTeamId]);
        expect(new Set(teams).size).toBe(4);
      }
    });

    it("fills a lineup from the squad in draft order", async () => {
      const res = await teamRound(1, 1, 1);
      expect(res.body.lineup).toEqual({ starters: { HB_HK: [11], FWD: [12], OB: [13] }, bench: [14] });
      expect(res.body).toMatchObject({ lineupSource: "auto", editable: true, roundStatus: "upcoming" });
      expect(res.body.players.find((p) => p.id === 14)).toMatchObject({ note: "bye", status: "dnp" });
    });

    it("saves a lineup, and later rounds carry it forward", async () => {
      // Team 1 benches its winger (13) for the bye-bound centre (14): legal, just silly.
      const swapped = { starters: { HB_HK: [11], FWD: [12], OB: [14] }, bench: [13] };
      const res = await call<TeamRoundView>(users[1]!.id, "PUT", `/api/leagues/${leagueId}/teams/${teamIds[1]}/rounds/1/lineup`, swapped);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ lineupSource: "saved", lineup: swapped });
      expect((await teamRound(1, 1, 5)).body).toMatchObject({ lineupSource: "carried", lineup: swapped });
    });

    it("rejects bad lineups and other people's teams", async () => {
      const url = `/api/leagues/${leagueId}/teams/${teamIds[1]}/rounds/1/lineup`;
      expect((await call(users[1]!.id, "PUT", url, { starters: { HB_HK: [12], FWD: [11], OB: [13] }, bench: [14] })).status).toBe(400);
      expect((await call(users[2]!.id, "PUT", url, { starters: { HB_HK: [11], FWD: [12], OB: [13] }, bench: [14] })).status).toBe(403);
      expect((await teamRound(1, 1, 13)).status).toBe(404);
    });
  });

  describe("during a round", () => {
    beforeEach(async () => {
      clock = new Date(kickoff(1).getTime() - DAY);
      await seed(0);
      await makeLeague();
      clock = new Date(kickoff(1).getTime() + 60_000); // round 1 has kicked off
    });

    it("locks players whose game has started; bye players lock with the round", async () => {
      const res = await teamRound(0, 0, 1);
      expect(res.body.roundStatus).toBe("live");
      expect(res.body.players.every((p) => p.locked)).toBe(true);
      const url = `/api/leagues/${leagueId}/teams/${teamIds[0]}/rounds/1/lineup`;
      const moved = await call(users[0]!.id, "PUT", url, { starters: { HB_HK: [1], FWD: [2], OB: [4] }, bench: [3] });
      expect(moved).toMatchObject({ status: 409, body: { error: "player_locked" } });
    });

    it("still allows changes for the next round", async () => {
      const url = `/api/leagues/${leagueId}/teams/${teamIds[0]}/rounds/2/lineup`;
      expect((await call(users[0]!.id, "PUT", url, { starters: { HB_HK: [1], FWD: [2], OB: [4] }, bench: [3] })).status).toBe(200);
    });
  });

  describe("scores, ladder and finals", () => {
    beforeEach(async () => {
      clock = new Date(kickoff(1).getTime() - DAY);
      await seed(10);
      await makeLeague();
      clock = new Date(kickoff(10).getTime() + 3 * DAY); // regular season over
    });

    it("scores starters, bringing in an emergency for a player on a bye", async () => {
      const res = await teamRound(0, 0, 3);
      expect(res.body.roundStatus).toBe("complete");
      expect(res.body.score.provisional).toBe(false);
      expect(res.body.score.total).toBe(expected(0, 3));
      expect(res.body.score.slots.find((s) => s.slotKey === "OB")).toMatchObject({ starterId: 3, scorerId: 4, viaEmergency: true });
      expect(res.body.editable).toBe(false);
    });

    it("can't change a finished round", async () => {
      const url = `/api/leagues/${leagueId}/teams/${teamIds[0]}/rounds/3/lineup`;
      expect((await call(users[0]!.id, "PUT", url, { starters: { HB_HK: [1], FWD: [2], OB: [4] }, bench: [3] })).body).toMatchObject({ error: "round_over" });
    });

    it("lists each round's matchups with scores and winners", async () => {
      const res = await call<RoundView>(users[2]!.id, "GET", `/api/leagues/${leagueId}/rounds/4`);
      expect(res.body.matchups).toHaveLength(2);
      for (const m of res.body.matchups) {
        const h = teamIds.indexOf(m.home!.teamId);
        const a = teamIds.indexOf(m.away!.teamId);
        expect(m.home!.score).toBe(expected(h, 4));
        expect(m.away!.score).toBe(expected(a, 4));
        const winner = m.home!.score === m.away!.score ? null : m.home!.score > m.away!.score ? m.home!.teamId : m.away!.teamId;
        expect(m.winnerTeamId).toBe(winner);
      }
    });

    it("builds the ladder from the completed rounds", async () => {
      const res = await call<SeasonOverview>(users[0]!.id, "GET", `/api/leagues/${leagueId}/season`);
      const o = res.body;
      expect(o).toMatchObject({ firstRound: 1, lastRegularRound: 10, grandFinalRound: 12, currentRound: 11 });
      expect(o.ladder).toHaveLength(4);
      expect(o.ladder.every((r) => r.played === 10)).toBe(true);
      expect(o.ladder.reduce((s, r) => s + r.wins + r.draws / 2, 0)).toBe(20); // 20 games
      for (const row of o.ladder) {
        const t = teamIds.indexOf(row.teamId);
        const pf = Array.from({ length: 10 }, (_, i) => expected(t, i + 1)).reduce((a, b) => a + b, 0);
        expect(row.pointsFor).toBe(pf);
      }
    });

    it("seeds the finals from the ladder once the regular season is over", async () => {
      const o = (await call<SeasonOverview>(users[0]!.id, "GET", `/api/leagues/${leagueId}/season`)).body;
      const seeds = o.ladder.map((r) => r.teamId);
      expect(o.finals!.size).toBe(4);
      const semis = o.finals!.games.filter((g) => g.stage.startsWith("SF"));
      expect(semis.map((g) => [g.home!.teamId, g.away!.teamId])).toEqual([[seeds[0], seeds[3]], [seeds[1], seeds[2]]]);
      expect(semis.every((g) => g.round === 11 && g.winnerTeamId === null)).toBe(true);
      const r11 = (await call<RoundView>(users[0]!.id, "GET", `/api/leagues/${leagueId}/rounds/11`)).body;
      expect(r11.matchups.map((m) => m.stage)).toEqual(["SF1", "SF2"]);
    });
  });

  describe("first round", () => {
    beforeEach(async () => {
      await seed(0);
    });

    it("is the first round that hasn't started, mid-season", async () => {
      expect(await db.$transaction((tx) => firstFantasyRound(tx, 2027, new Date(kickoff(4).getTime() + DAY)))).toBe(5);
    });

    it("is round 1 before the season, and for a season without a draw", async () => {
      expect(await db.$transaction((tx) => firstFantasyRound(tx, 2027, new Date(kickoff(1).getTime() - DAY)))).toBe(1);
      expect(await db.$transaction((tx) => firstFantasyRound(tx, 2030, new Date()))).toBe(1);
    });
  });
});
