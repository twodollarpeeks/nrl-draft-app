// Usage (from the repo root):
//   npm run nrl:import -- --season 2026 --round 5
//   npm run nrl:import -- --season 2026 --from 1 --to 27
//   npm run nrl:import -- --season 2026 --round 5 --force
//   npm run nrl:import -- --current      (the scheduled job: this round + last round)
//   --skip-profiles   don't look up profile positions for never-started players

import { parseArgs } from "node:util";
import { createPrisma } from "@nrl/db";
import { PoliteFetcher } from "./http.ts";
import { NrlImporter } from "./importer.ts";
import { CURRENT_DRAW_URL, LAST_REGULAR_ROUND, parseCurrentRound } from "./normalise.ts";

const { values } = parseArgs({
  options: {
    season: { type: "string" },
    round: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    current: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "skip-profiles": { type: "boolean", default: false },
  },
});

const http = new PoliteFetcher();
let season: number, from: number, to: number;
if (values.current) {
  // Last round too: its stats keep being corrected for days after full time.
  const cur = parseCurrentRound(await http.getText(CURRENT_DRAW_URL));
  console.log(`[nrl] current round: ${cur.season} round ${cur.round}`);
  season = cur.season;
  from = Math.max(1, cur.round - 1);
  to = cur.round;
} else {
  season = Number(values.season ?? new Date().getFullYear());
  from = Number(values.round ?? values.from ?? 1);
  to = Number(values.round ?? values.to ?? LAST_REGULAR_ROUND + 4);
}
if (![season, from, to].every(Number.isInteger) || from > to) {
  console.error("Usage: --current | --season <year> (--round <n> | --from <n> --to <n>) [--force]");
  process.exit(1);
}

const db = createPrisma();
const importer = new NrlImporter(db, http);
let failed = 0;
try {
  for (let round = from; round <= to; round++) {
    try {
      await importer.importRound(season, round, { force: values.force });
    } catch (err) {
      failed++;
      console.error(`[nrl] ERROR ${season} round ${round}:`, err);
    }
  }
  if (!values["skip-profiles"]) await importer.fillMissingPositions(season);
} finally {
  await db.$disconnect();
}
process.exit(failed ? 1 : 0);
