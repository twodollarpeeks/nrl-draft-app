import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

// .env lives at the repo root, not in this package.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // The CLI (migrations) needs Neon's direct, unpooled connection. The app
  // itself connects through the pooled DATABASE_URL (see src/index.ts).
  // Generating the client needs no database, so builds without one (the web
  // app on Vercel) still work; migrations fail clearly if it's missing.
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
