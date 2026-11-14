import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hasTestDb, resetDb, testDb } from "../../../test/db.ts";
import { buildTestSeason, shiftTestSeason, syncTestSeason } from "./testSeason.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe.skipIf(!hasTestDb)("test seasons", () => {
  const db = testDb();
  // The real season: round 1's games on day 0 and day 1, round 2's on day 7.
  const t0 = new Date("2030-03-07T09:00:00Z").getTime();

  beforeEach(async () => {
    await resetDb(db);
    await db.club.create({ data: { id: 1, key: "storm", nickName: "Storm" } });
    await db.club.create({ data: { id: 2, key: "broncos", nickName: "Broncos" } });
    await db.player.create({ data: { id: 1, firstName: "A", lastName: "One", positions: ["HB"], positionsOverride: [], clubId: 1 } });
    const games: Array<[number, string, number]> = [[1, "m1", 0], [1, "m2", DAY], [2, "m3", 7 * DAY]];
    for (const [number, id, at] of games) {
      const round = await db.round.upsert({
        where: { season_number: { season: 2030, number } },
        create: { season: 2030, number, title: `Round ${number}`, slug: `round-${number}`, byeClubKeys: [] },
        update: {},
      });
      await db.match.create({
        data: { id, roundId: round.id, homeClubId: 1, awayClubId: 2, kickoffAt: new Date(t0 + at), url: `/${id}`, state: "FullTime", homeScore: 20, awayScore: 10 },
      });
      await db.appearance.create({
        data: { matchId: id, playerId: 1, clubId: 1, jersey: 7, positionLabel: "Halfback", isStarter: true, minutes: 80, tries: 2, stats: { tries: 2 } },
      });
    }
  });
  afterAll(async () => {
    await resetDb(db);
    await db.$disconnect();
  });

  const match = (id: string) => db.match.findUniqueOrThrow({ where: { id: `test-${id}` }, include: { appearances: true } });

  it("copies the draw, moved, and reveals games as the clock passes them", async () => {
    const shift = 10 * 7 * DAY;
    // An hour into round 1's first game (moved).
    const now = new Date(t0 + shift + HOUR);
    await buildTestSeason(db, 2030, 1030, shift, now);

    const m1 = await match("m1");
    expect(m1.kickoffAt.getTime()).toBe(t0 + shift);
    expect(m1.state).toBe("SecondHalf");
    expect(m1.appearances[0]?.tries).toBe(2);
    expect(m1.homeScore).toBeNull();

    // The next game's team list is out, without stats; next round's isn't.
    const m2 = await match("m2");
    expect(m2.state).toBe("Upcoming");
    expect(m2.appearances).toHaveLength(1);
    expect(m2.appearances[0]?.minutes).toBeNull();
    expect((await match("m3")).appearances).toHaveLength(0);

    // Full time two hours after kickoff.
    await syncTestSeason(db, 1030, new Date(t0 + shift + 2 * HOUR));
    expect(await match("m1")).toMatchObject({ state: "FullTime", homeScore: 20, awayScore: 10 });

    // The real season is untouched.
    expect(await db.match.count({ where: { round: { season: 2030 } } })).toBe(3);
    expect(await db.appearance.count({ where: { match: { round: { season: 2030 } } } })).toBe(3);
  });

  it("moves the whole season on", async () => {
    const shift = 10 * 7 * DAY;
    const now = new Date(t0 + shift - DAY);
    await buildTestSeason(db, 2030, 1030, shift, now);
    expect((await match("m1")).state).toBe("Upcoming");

    // A week on: round 1 has been played, round 2 hasn't started.
    await shiftTestSeason(db, 1030, -7 * DAY, now);
    expect((await match("m1")).state).toBe("FullTime");
    expect((await match("m2")).state).toBe("FullTime");
    const m3 = await match("m3");
    expect(m3.kickoffAt.getTime()).toBe(t0 + shift);
    expect(m3.state).toBe("Upcoming");

    // And back again: round 1's games are unplayed, with team lists but no stats.
    await shiftTestSeason(db, 1030, 7 * DAY, now);
    const m1 = await match("m1");
    expect(m1).toMatchObject({ state: "Upcoming", homeScore: null });
    expect(m1.appearances.map((a) => a.minutes)).toEqual([null]);
  });
});
