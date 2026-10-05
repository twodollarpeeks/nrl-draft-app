// Season fantasy points for every player under a given scoring, as a CSV:
// one row per player (total, average, round-by-round), regular season only.
//
//   npm run report:points -- --season 2026 --tackles 0.25 --tries 8
//   npm run report:points -- --only --tries 8 --lineBreaks 3   (start from nothing)
//   Any stat in the catalogue can be given (e.g. --lineBreaks, --sinBins);
//   unspecified stats use the default scoring unless --only. --out sets the file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { createPrisma } from "@nrl/db";
import { playerPoints } from "@nrl/scoring";
import { DEFAULT_SCORING, SCORING_STATS, activeStats, effectivePositions, statLineFromRaw, type ScoringRules } from "@nrl/shared";

const { values } = parseArgs({
  options: {
    season: { type: "string", default: "2026" },
    out: { type: "string" },
    only: { type: "boolean", default: false },
    ...Object.fromEntries(SCORING_STATS.map((s) => [s, { type: "string" as const }])),
  },
});

const season = Number(values.season);
const rules: ScoringRules = values.only ? {} : { ...DEFAULT_SCORING };
for (const stat of SCORING_STATS) {
  const v = (values as Record<string, string | boolean | undefined>)[stat];
  if (typeof v === "string") rules[stat] = Number(v);
}
const tag = activeStats(rules).map((s) => `${s}${rules[s]}`).join("_");
const out = values.out ?? `reports/${season}-points-${tag}.csv`;
const ROUNDS = Array.from({ length: 27 }, (_, i) => i + 1);

const db = createPrisma();
const apps = await db.appearance.findMany({
  where: { minutes: { gt: 0 }, match: { round: { season, number: { lte: 27 } } } },
  select: {
    playerId: true, stats: true,
    match: { select: { round: { select: { number: true } } } },
  },
});
const players = new Map((await db.player.findMany({ include: { club: true } })).map((p) => [p.id, p]));
await db.$disconnect();

const byPlayer = new Map<number, Map<number, number>>();
for (const a of apps) {
  const pts = playerPoints(statLineFromRaw((a.stats ?? {}) as Record<string, unknown>), rules);
  const rounds = byPlayer.get(a.playerId) ?? new Map<number, number>();
  rounds.set(a.match.round.number, (rounds.get(a.match.round.number) ?? 0) + pts);
  byPlayer.set(a.playerId, rounds);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const rows = [...byPlayer.entries()]
  .map(([id, rounds]) => {
    const total = r1([...rounds.values()].reduce((s, x) => s + x, 0));
    return { p: players.get(id)!, rounds, total, games: rounds.size, avg: r1(total / rounds.size) };
  })
  .sort((a, b) => b.total - a.total);

const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const lines = [["Rank", "Player", "Club", "Positions", "Games", "Total", "Average", ...ROUNDS.map((r) => `R${r}`)].join(",")];
rows.forEach((r, i) =>
  lines.push(
    [
      i + 1, `${r.p.firstName} ${r.p.lastName}`, r.p.club?.nickName ?? "", effectivePositions(r.p).join("/"),
      r.games, r.total, r.avg, ...ROUNDS.map((n) => (r.rounds.has(n) ? r1(r.rounds.get(n)!) : "")),
    ].map(esc).join(","),
  ),
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\r\n") + "\r\n");

console.log(`Scoring: ${activeStats(rules).map((s) => `${s} ${rules[s]}`).join(", ")}`);
console.log(`Wrote ${rows.length} players to ${out}`);
