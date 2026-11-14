// Sample league for local testing and demos: a finished draft and a scored
// season, built from an already-imported NRL season (2026 by default).
//
//   npm run seed -- --owner you@gmail.com            (you're the commissioner)
//   npm run seed -- --owner you@gmail.com --teams 10 --season 2026
//   npm run seed -- --reset                          (just delete sample leagues)
//
// The owner must have signed in once (accounts come from Google). Without
// --owner a demo manager is the commissioner. Re-running replaces the previous
// sample league. Demo managers use @seed.invalid emails and can't sign in.

import { parseArgs } from "node:util";
import { createPrisma } from "@nrl/db";
import { createSampleLeague, deleteSampleLeagues } from "./sampleLeague.ts";

const { values } = parseArgs({
  options: {
    owner: { type: "string" },
    teams: { type: "string", default: "8" },
    season: { type: "string", default: "2026" },
    name: { type: "string", default: "Sample League" },
    reset: { type: "boolean", default: false },
  },
});

const db = createPrisma();

try {
  if (values.reset) {
    console.log(`Removed ${await deleteSampleLeagues(db)} sample league(s).`);
    process.exit(0);
  }

  // Check everything before touching the existing sample league.
  const season = Number(values.season);
  const teamCount = Number(values.teams);
  if (!Number.isInteger(teamCount) || teamCount < 4 || teamCount > 18) throw new Error("--teams must be 4-18");
  if ((await db.round.count({ where: { season } })) === 0) {
    throw new Error(`No ${season} data. Import it first: npm run nrl:import -- --season ${season}`);
  }
  const owner = values.owner ? await db.user.findUnique({ where: { email: values.owner.toLowerCase() } }) : null;
  if (values.owner && !owner) {
    throw new Error(`No account for ${values.owner}. Sign in with Google once, then run this again.`);
  }

  const removed = await deleteSampleLeagues(db);
  if (removed) console.log(`Replacing the previous sample league.`);

  const { league, totalPicks } = await createSampleLeague(db, { owner, teamCount, season, name: values.name! });
  console.log(`Created "${league.name}" (${season}, ${teamCount} teams, ${totalPicks} picks).`);
  console.log(`Open it at /l/${league.id}`);
  if (!values.owner) console.log("Tip: add --owner you@gmail.com to be in it yourself.");
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
