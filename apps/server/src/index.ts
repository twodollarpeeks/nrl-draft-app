import { buildApp } from "./app.ts";
import { loadEnv } from "./env.ts";

const env = loadEnv();
const app = await buildApp(env);

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
