import { describe, expect, it } from "vitest";
import { parseCurrentRound, parseDraw, parseMatch, profilePath } from "./normalise.ts";
import { decodeHtmlEntities, extractProfilePosition } from "./qdata.ts";
import { fixturePage } from "./testUtils.ts";

describe("parseDraw (2026 round 5)", () => {
  const draw = parseDraw(fixturePage("draw-2026-r5.json"), 2026, 5)!;

  it("reads the round", () => {
    expect(draw.round).toMatchObject({
      season: 2026, number: 5, title: "Round 5", slug: "round-5", isFinals: false,
    });
  });

  it("reads all 8 matches with UTC kickoffs", () => {
    expect(draw.matches).toHaveLength(8);
    expect(draw.matches[0]).toMatchObject({
      url: "/draw/nrl-premiership/2026/round-5/dolphins-v-sea-eagles/",
      homeClubId: 500723,
      awayClubId: 500002,
      state: "FullTime",
      homeScore: 18,
      awayScore: 52,
    });
    expect(draw.matches[0]!.kickoffAt.toISOString()).toBe("2026-04-02T09:00:00.000Z");
  });

  it("reads byes as club keys", () => {
    expect(draw.round.byeClubKeys).toEqual(["roosters"]);
  });

  it("collects the 16 clubs that played", () => {
    expect(draw.clubs).toHaveLength(16);
    expect(draw.clubs.find((c) => c.id === 500002)).toMatchObject({ key: "sea-eagles", nickName: "Sea Eagles" });
  });

  it("reads which round a draw page is showing", () => {
    expect(parseCurrentRound(fixturePage("draw-2026-r5.json"))).toEqual({ season: 2026, round: 5 });
  });

  it("returns null when nrl.com serves a different round than asked for", () => {
    expect(parseDraw(fixturePage("draw-2026-r5.json"), 2026, 6)).toBeNull();
  });
});

describe("parseMatch (Dolphins v Sea Eagles, 2026 R5)", () => {
  const m = parseMatch(fixturePage("match-2026-r5-dolphins-v-sea-eagles.json"));

  it("reads the match", () => {
    expect(m.match).toMatchObject({
      id: "20261110510",
      url: "/draw/nrl-premiership/2026/round-5/dolphins-v-sea-eagles/",
      state: "FullTime",
      homeClubId: 500723,
      awayClubId: 500002,
    });
  });

  it("has 19 named players a side", () => {
    expect(m.appearances).toHaveLength(38);
    expect(m.players).toHaveLength(38);
  });

  it("maps the six scoring stats (cross-checked against the scraped CSV)", () => {
    const htf = m.appearances.find((a) => a.playerId === 100001936)!;
    expect(htf).toMatchObject({
      jersey: 1, positionLabel: "Fullback", isStarter: true, minutes: 80,
      runMetres: 213, tackles: 10, tries: 2, tryAssists: 0, goals: 0, errors: 2,
    });
    expect(htf.stats?.lineBreaks).toBe(1);
  });

  it("counts goals as conversions + penalty goals (nrl.com's goals field is always 0)", () => {
    const goals = (id: number) => m.appearances.find((a) => a.playerId === id)!.goals;
    expect(goals(502014)).toBe(3); // 3 conversions
    expect(goals(501175)).toBe(8); // 7 conversions + 1 penalty goal
  });

  it("marks interchange and reserves as non-starters", () => {
    const labels = (starter: boolean) =>
      new Set(m.appearances.filter((a) => a.isStarter === starter).map((a) => a.positionLabel));
    expect(labels(false)).toEqual(new Set(["Interchange", "Reserve"]));
    expect(m.appearances.filter((a) => a.isStarter)).toHaveLength(26);
  });

  it("records 0 minutes for named players who didn't take the field", () => {
    const unused = m.appearances.filter((a) => a.minutes === 0);
    expect(unused.length).toBeGreaterThan(0);
    expect(unused.every((a) => a.positionLabel === "Reserve")).toBe(true);
  });
});

describe("helpers", () => {
  it("decodes HTML entities, ampersands last", () => {
    expect(decodeHtmlEntities("&quot;a&quot; &amp;lt; &#39;b&#x27; &lt;c&gt;")).toBe(`"a" &lt; 'b' <c>`);
  });

  it("extracts the profile position", () => {
    expect(extractProfilePosition(`<p class="club-card__position">Prop</p>`)).toBe("Prop");
    expect(extractProfilePosition(`<p>nothing</p>`)).toBeNull();
  });

  it("builds an nrl.com profile path from a club-site URL", () => {
    expect(
      profilePath("dolphins", "https://www.dolphinsnrl.com.au/teams/nrl-premiership/dolphins/thomas-flegler/"),
    ).toBe("/players/nrl-premiership/dolphins/thomas-flegler/");
  });
});
