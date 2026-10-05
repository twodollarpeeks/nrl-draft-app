import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

export interface CreatePrismaOptions {
  connectionString?: string;
  /** Postgres schema to use instead of "public" (tests use "test"). */
  schema?: string;
}

export function createPrisma(opts: CreatePrismaOptions = {}): PrismaClient {
  const connectionString = opts.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString }, opts.schema ? { schema: opts.schema } : undefined);
  return new PrismaClient({ adapter });
}
