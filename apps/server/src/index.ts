import { createPrisma } from "@nrl/db";
import { buildApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { loadEnv } from "./env.ts";

const env = loadEnv();
const db = createPrisma({ connectionString: env.DATABASE_URL });
const auth = createAuth(env, db);
if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
  console.warn("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set: Google sign-in is disabled");
}
const app = await buildApp({ env, db, auth, realtime: true });

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
