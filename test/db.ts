import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createPrisma, type PrismaClient } from "@nrl/db";

export const TEST_SCHEMA = "test";

export function withSchema(url: string, schema: string): string {
  const u = new URL(url);
  u.searchParams.set("schema", schema);
  return u.toString();
}

config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

/** True when a database is configured; use with describe.runIf. */
export const hasTestDb = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);

export function testDb(): PrismaClient {
  return createPrisma({ schema: TEST_SCHEMA });
}

/** Empty every table in the test schema. */
export async function resetDb(db: PrismaClient) {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = ${TEST_SCHEMA} AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${TEST_SCHEMA}"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}

let userSeq = 0;
export async function createUser(db: PrismaClient, name = "Test User") {
  userSeq++;
  const now = new Date();
  return db.user.create({
    data: {
      id: `user_${userSeq}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      email: `user${userSeq}.${Date.now()}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
}
