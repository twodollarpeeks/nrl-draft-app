// Keep the free-tier API awake when it's needed. Render's free plan sleeps
// after 15 minutes without traffic and takes up to a minute to wake, which
// would stall a draft clock or a scheduled draft start. Run every 10 minutes
// (GitHub Actions): if a draft is live, or one starts within the next 40
// minutes, ping the API's health check until it answers.
//
//   API_URL=https://nrl-draft-api.onrender.com npm run wake

import { createPrisma } from "@nrl/db";

const API_URL = process.env.API_URL;
const LOOKAHEAD_MS = 40 * 60_000;

const db = createPrisma();
const [live, soon] = await Promise.all([
  db.draft.count({ where: { status: { in: ["live", "paused"] } } }),
  db.league.count({ where: { status: "setup", draftAt: { lte: new Date(Date.now() + LOOKAHEAD_MS) } } }),
]);
await db.$disconnect();

if (!live && !soon) {
  console.log("No live or upcoming drafts: letting the API sleep.");
  process.exit(0);
}
if (!API_URL) {
  console.error("API_URL is not set");
  process.exit(1);
}
console.log(`${live} live draft(s), ${soon} starting soon: waking ${API_URL}`);
for (let attempt = 1; attempt <= 12; attempt++) {
  try {
    const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(20_000) });
    if (res.ok) {
      console.log(`Awake (attempt ${attempt}).`);
      process.exit(0);
    }
    console.log(`HTTP ${res.status}, retrying`);
  } catch (err) {
    console.log(`${(err as Error).message}, retrying`);
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
console.error("API didn't wake up.");
process.exit(1);
