import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig, env } from "prisma/config";

// .env lives at the repo root, not in this package.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // The CLI (migrations) needs Neon's direct, unpooled connection. The app
  // itself connects through the pooled DATABASE_URL (see src/index.ts).
  datasource: {
    url: env("DIRECT_URL"),
  },
});
