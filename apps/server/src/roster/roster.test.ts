import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LEAGUE_SETTINGS,
  type ActivityItem,
  type LeagueSettings,
  type PlayersView,
  type TeamRoundView,
  type TradesView,
} from "@nrl/shared";
import { createUser, hasTestDb, resetDb, testDb } from "../../../../test/db.ts";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { startSeason } from "../season/setup.ts";

// The season tests' league: 4 teams of 4 (HF/HK, FWD, OB, one bench), 10 points a try.
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
// Thursdays in March 2027 (Sydney is on daylight time: waivers clear Tuesdays 19:00 UTC).
const kickoff = (round: number) => new Date(new Date("2027-03-04T09:00:00Z").getTime() + (round - 1) * 7 * DAY);

// Alpha (1) plays Bravo (2) every round; Charlie (3) has the bye.
function squad(t: number) {
  const base = t * 10;
  const ob = t === 0 ? [{ id: base + 3, pos: "CE", club: 3 }, { id: base + 4, pos: "WG", club: 1 }] : [{ id: base + 3, pos: "WG", club: 1 }, { id: base + 4, pos: "CE", club: 3 }];
  return [{ id: base + 1, pos: "HB", club: 1 }, { id: base + 2, pos: "FRF", club: 2 }, ...ob];
}
// Unowned players.
const FREE = [{ id: 500, pos: "WG", club: 1 }, { id: 501, pos: "FRF", club: 2 }, { id: 502, pos: "CE", club: 3 }];
const tries = (playerId: number, round: number) => (playerId + round) % 3;

describe.runIf(hasTestDb)("free agency and waivers", () => {
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
    return { status: res.statusCode, body: (res.body ? res.json() : null) as T };
  }

  let leagueId = "";
  let users: Array<{ id: string }> = [];
  let teamIds: string[] = [];

  /** Rounds up to `played` have been played (full time, with stats). */
  async function seed(played: number) {
    await db.club.createMany({
      data: [
        { id: 1, key: "alpha", nickName: "Alpha" },
        { id: 2, key: "bravo", nickName: "Bravo" },
        { id: 3, key: "charlie", nickName: "Charlie" },
      ],
    });
    const everyone = [...[0, 1, 2, 3].flatMap(squad), ...FREE];
    for (const p of everyone) {
      await db.player.create({ data: { id: p.id, firstName: "P", lastName: String(p.id), clubId: p.club, positions: [p.pos], positionsOverride: [] } });
    }
    for (let r = 1; r <= 12; r++) {
      const round = await db.round.create({ data: { season: 2027, number: r, title: `Round ${r}`, slug: `round-${r}`, byeClubKeys: ["charlie"] } });
      const done = r <= played;
      await db.match.create({
        data: { id: `m${r}`, roundId: round.id, homeClubId: 1, awayClubId: 2, kickoffAt: kickoff(r), url: `/m${r}`, state: done ? "FullTime" : "Upcoming" },
      });
      if (!done) continue;
      for (const p of everyone.filter((x) => x.club !== 3)) {
        await db.appearance.create({
          data: { matchId: `m${r}`, playerId: p.id, clubId: p.club, jersey: 1, positionLabel: "x", isStarter: true, minutes: 80, stats: { tries: tries(p.id, r) } },
        });
      }
    }
  }

  async function makeLeague() {
    users = [];
    for (let i = 0; i < 4; i++) users.push(await createUser(db, `Manager ${i}`));
    const created = await call<{ id: string; inviteCode: string }>(users[0]!.id, "POST", "/api/leagues", {
      name: "Waiver Test", season: 2027, settings: SETTINGS, draftOrderMode: "manual",
    });
    leagueId = created.body.id;
    for (const u of users.slice(1)) await call(u.id, "POST", `/api/invites/${created.body.inviteCode}/join`, {});
    const teams = await db.team.findMany({ where: { leagueId } });
    teamIds = users.map((u) => teams.find((t) => t.ownerId === u.id)!.id);
    const draft = await db.draft.create({ data: { leagueId, status: "complete", pickSeconds: 60, order: teamIds, totalPicks: 16, currentPick: 17 } });
    let pickNo = 0;
    for (let t = 0; t < 4; t++) {
      for (const p of squad(t)) {
        pickNo++;
        await db.draftPick.create({ data: { draftId: draft.id, pickNo, round: 1, teamId: teamIds[t]!, playerId: p.id, madeBy: "manager" } });
        await db.rosterEntry.create({ data: { leagueId, teamId: teamIds[t]!, playerId: p.id, acquiredVia: "draft" } });
      }
    }
    await db.league.update({ where: { id: leagueId }, data: { status: "inSeason", draftOrder: teamIds } });
    await db.$transaction((tx) => startSeason(tx, leagueId, teamIds, new Date(kickoff(1).getTime() - DAY)));
  }

  const players = (u: number) => call<PlayersView>(users[u]!.id, "GET", `/api/leagues/${leagueId}/players`);
  const player = async (u: number, id: number) => (await players(u)).body.players.find((p) => p.id === id)!;
  const add = (u: number, t: number, playerId: number, dropPlayerId?: number) =>
    call<{ error: string; message: string }>(users[u]!.id, "POST", `/api/leagues/${leagueId}/roster/add`, { teamId: teamIds[t], playerId, dropPlayerId });
  const drop = (u: number, t: number, playerId: number) =>
    call<{ error: string; message: string }>(users[u]!.id, "POST", `/api/leagues/${leagueId}/roster/drop`, { teamId: teamIds[t], playerId });
  const claim = (u: number, t: number, playerId: number, dropPlayerId?: number) =>
    call<{ error: string; message: string }>(users[u]!.id, "POST", `/api/leagues/${leagueId}/waivers/claims`, { teamId: teamIds[t], playerId, dropPlayerId });
  const teamRound = (u: number, t: number, r: number) =>
    call<TeamRoundView>(users[u]!.id, "GET", `/api/leagues/${leagueId}/teams/${teamIds[t]}/rounds/${r}`);
  const squadIds = async (t: number) =>
    (await db.rosterEntry.findMany({ where: { teamId: teamIds[t], releasedAt: null } })).map((e) => e.playerId).sort((a, b) => a - b);

  beforeEach(async () => {
    await resetDb(db);
    // Wednesday before round 3, after that morning's waiver clearing.
    clock = new Date(kickoff(3).getTime() - DAY);
    await seed(3);
    await makeLeague();
  });
  afterAll(async () => {
    await (await appPromise).close();
    await db.$disconnect();
  });

  it("lists who's available, with this season's averages", async () => {
    const view = (await players(0)).body;
    expect(view.squadMax).toBe(4);
    expect(view.waivers.order).toEqual([...teamIds].reverse());
    expect(view.waivers.nextClear).toBe("2027-03-23T19:00:00.000Z");
    expect(view.players.find((p) => p.id === 500)).toMatchObject({ availability: "free", ownerTeamId: null, seasonGames: 3, locked: false });
    expect(view.players.find((p) => p.id === 1)).toMatchObject({ availability: "owned", ownerTeamId: teamIds[0] });
  });

  it("keeps earlier rounds' scores when a player who scored in them is dropped", async () => {
    // Team 0's winger (4) came off the bench for the centre on a bye in rounds 1 and 2.
    const r1 = await teamRound(0, 0, 1);
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    const before = await Promise.all([1, 2].map(async (r) => (await teamRound(0, 0, r)).body.score.total));
    expect((await drop(0, 0, 4)).status).toBe(204);
    expect(await squadIds(0)).toEqual([1, 2, 3]);
    const after = await Promise.all([1, 2].map(async (r) => (await teamRound(0, 0, r)).body));
    expect(after.map((v) => v.score.total)).toEqual(before);
    expect(after[0]!.players.map((p) => p.id)).toContain(4);
    // Round 3 hasn't started: it's the new squad.
    expect((await teamRound(0, 0, 3)).body.players.map((p) => p.id)).not.toContain(4);
  });

  it("picks up free agents, dropping someone when the squad is full", async () => {
    expect((await add(0, 0, 500)).body).toMatchObject({ error: "squad_full" });
    expect((await add(0, 0, 500, 4)).status).toBe(204);
    expect(await squadIds(0)).toEqual([1, 2, 3, 500]);
    expect((await add(1, 1, 500, 13)).body).toMatchObject({ error: "player_owned" });
    // Round 3's lineup has them (on the bench, the outside back spot is taken).
    expect((await teamRound(0, 0, 3)).body.lineup.bench).toContain(500);
  });

  it("puts dropped players on waivers; claims settle at the next clearing in rolling order", async () => {
    await drop(0, 0, 4);
    expect((await player(1, 4)).availability).toBe("waivers");
    expect((await add(1, 1, 4, 13)).body).toMatchObject({ error: "on_waivers" });
    expect((await claim(1, 1, 500, 13)).body).toMatchObject({ error: "free_agent" });

    // Order is reverse draft: team 3, 2, 1, 0. Teams 1 and 2 both want player 4.
    expect((await claim(1, 1, 4, 13)).status).toBe(204);
    expect((await claim(2, 2, 4, 23)).status).toBe(204);
    expect((await claim(2, 2, 4, 23)).body).toMatchObject({ error: "already_claimed" });
    expect((await players(2)).body.claims).toMatchObject([{ rank: 1, player: { id: 4 }, drop: { id: 23 } }]);

    // Nothing happens before the clearing...
    clock = new Date("2027-03-23T18:59:00Z");
    expect(await squadIds(2)).toContain(23);
    await players(0);
    expect(await squadIds(2)).toContain(23);

    // ...then the first read after it settles the claims.
    clock = new Date("2027-03-23T19:05:00Z");
    const view = (await players(0)).body;
    expect(await squadIds(2)).toEqual([4, 21, 22, 24]);
    expect(await squadIds(1)).toContain(13);
    expect(view.waivers.order).toEqual([teamIds[3], teamIds[1], teamIds[0], teamIds[2]]);
    const claims = await db.waiverClaim.findMany({ orderBy: { teamId: "asc" } });
    expect(claims.map((c) => c.status).sort()).toEqual(["lost", "won"]);
    // Team 2's dropped player is on waivers until the next clearing.
    expect((await player(0, 23)).availability).toBe("waivers");

    const activity = (await call<ActivityItem[]>(users[0]!.id, "GET", `/api/leagues/${leagueId}/activity`)).body;
    expect(activity.map((a) => a.text)).toEqual([
      expect.stringMatching(/claimed P 4 off waivers, dropping P 23/),
      expect.stringMatching(/dropped P 4/),
    ]);
  });

  it("locks players once their game this round starts; they go on waivers until the next clearing", async () => {
    clock = new Date(kickoff(3).getTime() + 3_600_000);
    expect((await drop(0, 0, 1)).body).toMatchObject({ error: "player_locked" });
    expect((await add(0, 0, 501, 3)).body).toMatchObject({ error: "on_waivers" });
    expect((await player(0, 501)).locked).toBe(true);
    // The round is still going after its games: still locked, and still on waivers once it's over.
    clock = new Date(kickoff(3).getTime() + 3 * DAY);
    expect((await player(0, 501)).availability).toBe("waivers");
    // After the next clearing they're free agents again.
    clock = new Date("2027-03-23T19:05:00Z");
    expect((await player(0, 501)).availability).toBe("free");
    expect((await add(0, 0, 501, 3)).status).toBe(204);
  });

  it("lets only the team's manager, or the commissioner, change a squad", async () => {
    expect((await drop(1, 0, 4)).status).toBe(403);
    expect((await drop(0, 1, 14)).status).toBe(204); // user 0 is the commissioner
    expect(await squadIds(1)).toEqual([11, 12, 13]);
  });

  it("lets a team order and cancel its claims", async () => {
    await drop(0, 0, 4);
    await drop(0, 0, 3);
    await claim(1, 1, 4, 13);
    await claim(1, 1, 3, 14);
    const mine = (await players(1)).body.claims;
    expect(mine.map((c) => c.player.id)).toEqual([4, 3]);
    await call(users[1]!.id, "PUT", `/api/leagues/${leagueId}/waivers/claims`, { teamId: teamIds[1], claimIds: [mine[1]!.id, mine[0]!.id] });
    expect((await players(1)).body.claims.map((c) => c.player.id)).toEqual([3, 4]);
    expect((await call(users[1]!.id, "DELETE", `/api/leagues/${leagueId}/waivers/claims/${mine[0]!.id}`)).status).toBe(204);
    expect((await players(1)).body.claims.map((c) => c.player.id)).toEqual([3]);
  });

  describe("trades", () => {
    const trades = (u: number) => call<TradesView>(users[u]!.id, "GET", `/api/leagues/${leagueId}/trades`);
    const propose = (u: number, from: number, to: number, give: number[], get: number[]) =>
      call<{ error: string; message: string }>(users[u]!.id, "POST", `/api/leagues/${leagueId}/trades`, {
        fromTeamId: teamIds[from], toTeamId: teamIds[to], give, get, message: "Deal?",
      });
    const act = (u: number, tradeId: string, action: string, body?: unknown) =>
      call<{ error: string }>(users[u]!.id, "POST", `/api/leagues/${leagueId}/trades/${tradeId}/${action}`, body ?? {});
    const latest = async (u = 0) => (await trades(u)).body.trades[0]!;

    it("checks a proposal: your own players, theirs, and room in both squads", async () => {
      expect((await propose(1, 0, 1, [4], [13])).status).toBe(403); // not their team
      expect((await propose(0, 0, 1, [13], [14])).body).toMatchObject({ error: "not_in_squad" });
      expect((await propose(0, 0, 1, [4], [13, 14])).body).toMatchObject({ error: "squad_full" });
      expect((await propose(0, 0, 1, [4], [13])).status).toBe(204);
      const t = await latest(1);
      expect(t).toMatchObject({ status: "proposed", message: "Deal?", give: [{ id: 4 }], get: [{ id: 13 }] });
      expect(t.can).toMatchObject({ accept: true, reject: true, cancel: false });
      expect((await latest(0)).can).toMatchObject({ accept: false, cancel: true });
    });

    it("goes through a day after it's accepted, keeping earlier rounds as they were", async () => {
      clock = new Date(kickoff(3).getTime() - 3 * DAY); // the review ends before round 3
      const round1 = (await teamRound(0, 0, 1)).body.score.total;
      await propose(0, 0, 1, [4], [13]);
      const id = (await latest()).id;
      expect((await act(1, id, "accept")).status).toBe(204);
      const review = await latest(2);
      expect(review.status).toBe("review");
      expect(new Date(review.reviewEndsAt!).getTime()).toBe(clock.getTime() + DAY);

      // Other managers can vote; the two teams can't.
      expect((await act(1, id, "vote", { approve: true })).status).toBe(403);
      expect((await act(2, id, "vote", { approve: false })).status).toBe(204);
      expect((await act(3, id, "vote", { approve: true })).status).toBe(204);
      const names = (await trades(0)).body.teams.map((t) => t.name);
      expect((await latest(2))).toMatchObject({ myVote: false, votes: { approve: [names[3]], veto: [names[2]] } });

      clock = new Date(clock.getTime() + DAY - 60_000);
      await trades(0);
      expect(await squadIds(0)).toContain(4);
      clock = new Date(clock.getTime() + 120_000);
      expect((await latest()).status).toBe("completed");
      expect(await squadIds(0)).toEqual([1, 2, 3, 13]);
      expect(await squadIds(1)).toEqual([4, 11, 12, 14]);
      expect((await teamRound(0, 0, 1)).body.score.total).toBe(round1);
      const activity = (await call<ActivityItem[]>(users[0]!.id, "GET", `/api/leagues/${leagueId}/activity`)).body;
      expect(activity[0]!.text).toBe(`Trade: ${names[0]} get P 13; ${names[1]} get P 4`);
    });

    it("can be rejected or withdrawn before it's accepted", async () => {
      await propose(0, 0, 1, [4], [13]);
      const id = (await latest()).id;
      expect((await act(0, id, "reject")).status).toBe(403);
      expect((await act(0, id, "cancel")).status).toBe(204);
      expect((await act(1, id, "accept")).body).toMatchObject({ error: "trade_not_open" });
      clock = new Date(clock.getTime() + 1000);
      await propose(0, 0, 1, [4], [13]);
      expect((await act(1, (await latest()).id, "reject")).status).toBe(204);
      expect((await latest()).status).toBe("rejected");
    });

    it("lets the commissioner approve straight away or veto; managers can't", async () => {
      await propose(1, 1, 2, [13], [23]);
      const id = (await latest()).id;
      await act(2, id, "accept");
      expect((await act(1, id, "veto")).status).toBe(403);
      expect((await act(0, id, "veto", { note: "Too lopsided" })).status).toBe(204);
      expect(await latest()).toMatchObject({ status: "vetoed", note: "Too lopsided" });

      clock = new Date(clock.getTime() + 1000);
      await propose(1, 1, 2, [13], [23]);
      const again = (await latest()).id;
      await act(2, again, "accept");
      expect((await act(0, again, "approve")).status).toBe(204);
      expect((await latest()).status).toBe("completed");
      expect(await squadIds(1)).toContain(23);
    });

    it("waits for players' games to finish, and fails other offers for the same players", async () => {
      await propose(0, 0, 1, [4], [13]);
      const first = (await latest()).id;
      clock = new Date(clock.getTime() + 1000);
      await propose(0, 0, 2, [4], [23]);
      await act(1, first, "accept");
      clock = new Date(kickoff(3).getTime() + 3_600_000); // P 4 (Alpha) is playing
      expect((await act(0, first, "approve")).status).toBe(204);
      expect((await trades(0)).body.trades.find((t) => t.id === first)!.status).toBe("review");
      clock = new Date(kickoff(3).getTime() + 3 * DAY); // round 3 is over
      const list = (await trades(0)).body.trades;
      expect(list.find((t) => t.id === first)!.status).toBe("completed");
      expect(list.find((t) => t.id !== first)).toMatchObject({ status: "failed", note: expect.stringMatching(/traded elsewhere/) });
    });

    it("closes when the deadline round starts (two rounds before the finals by default)", async () => {
      expect((await trades(0)).body.deadline).toEqual({ round: 9, closed: false });
      await propose(0, 0, 1, [4], [13]);
      clock = new Date(kickoff(9).getTime() + 60_000);
      const view = (await trades(1)).body;
      expect(view.deadline).toEqual({ round: 9, closed: true });
      expect(view.trades[0]).toMatchObject({ status: "failed" });
      expect((await propose(0, 0, 1, [4], [13])).body).toMatchObject({ error: "trades_closed" });
    });
  });
});
