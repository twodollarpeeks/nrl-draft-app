import type { Prisma, PrismaClient } from "@nrl/db";
import { DEFAULT_SITE_CONFIG, SiteConfig, ScoringStat } from "@nrl/shared";

const KEY = "config";

const isStat = (s: unknown) => ScoringStat.safeParse(s).success;

/** The site config, falling back to the built-in defaults for anything unset. */
export async function getSiteConfig(db: PrismaClient): Promise<SiteConfig> {
  const row = await db.siteSetting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_SITE_CONFIG;
  const stored = row.value as Partial<SiteConfig>;
  // Ignore stats that are no longer in the catalogue rather than failing.
  return SiteConfig.parse({
    ...DEFAULT_SITE_CONFIG,
    ...stored,
    ...(stored.defaultScoring
      ? { defaultScoring: Object.fromEntries(Object.entries(stored.defaultScoring).filter(([k]) => isStat(k))) }
      : {}),
    ...(stored.commissionerStats ? { commissionerStats: stored.commissionerStats.filter(isStat) } : {}),
  });
}

export async function saveSiteConfig(db: PrismaClient, config: SiteConfig, adminEmail: string): Promise<SiteConfig> {
  const value = config as unknown as Prisma.InputJsonValue;
  await db.siteSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value, updatedBy: adminEmail },
    update: { value, updatedBy: adminEmail },
  });
  return config;
}
