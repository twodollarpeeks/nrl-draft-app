import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ScoringRules } from "./leagueSettings.ts";
import { RAW_STAT_FIELDS, STAT_CATALOGUE, statLineFromRaw } from "./scoringStats.ts";

const match = JSON.parse(
  readFileSync(new URL("../../nrl/src/__fixtures__/match-2026-r5-dolphins-v-sea-eagles.json", import.meta.url), "utf8"),
).match;
const lines: Array<Record<string, unknown>> = [...match.stats.players.homeTeam, ...match.stats.players.awayTeam];

describe("stat catalogue", () => {
  it("has unique keys", () => {
    const keys = STAT_CATALOGUE.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only reads fields nrl.com actually provides", () => {
    const available = new Set(Object.keys(lines[0]!));
    expect(RAW_STAT_FIELDS.filter((f) => !available.has(f))).toEqual([]);
  });

  it("maps a real stat line (Tabuai-Fidow, 2026 R5)", () => {
    const s = statLineFromRaw(lines.find((l) => l.playerId === 100001936)!);
    expect(s).toMatchObject({ runMetres: 213, tackles: 10, tries: 2, errors: 2, lineBreaks: 1, tackleBreaks: 5, minutesPlayed: 80 });
  });

  it("derives goals and missed conversions (nrl.com's own goals field is always 0)", () => {
    const s = statLineFromRaw(lines.find((l) => l.playerId === 501175)!); // 7/8 conversions + 1 penalty goal
    expect(s.goals).toBe(8);
    expect(s.missedGoals).toBe((lines.find((l) => l.playerId === 501175)!.conversionAttempts as number) - 7);
  });

  it("validates rules: known stats only, values within range", () => {
    expect(ScoringRules.safeParse({ lineBreaks: 3 }).success).toBe(true);
    expect(ScoringRules.safeParse({ notAStat: 3 }).success).toBe(false);
    expect(ScoringRules.safeParse({ tries: 500 }).success).toBe(false);
  });
});
