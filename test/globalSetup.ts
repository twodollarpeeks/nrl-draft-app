// Before the test run: if a database is configured, bring the "test" Postgres
// schema up to date with the migrations. Database tests use only that schema,
// never "public", so they can't touch real data.

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { TEST_SCHEMA, withSchema } from "./db.ts";

export default function setup() {
  config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
  const direct = process.env.DIRECT_URL;
  if (!direct || !process.env.DATABASE_URL) {
    console.log("[test] No DATABASE_URL/DIRECT_URL: database tests will be skipped");
    return;
  }
  execSync("npx prisma migrate deploy", {
    cwd: fileURLToPath(new URL("../packages/db", import.meta.url)),
    env: { ...process.env, DIRECT_URL: withSchema(direct, TEST_SCHEMA) },
    stdio: "pipe",
  });
}
