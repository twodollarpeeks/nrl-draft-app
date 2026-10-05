-- A player can be on at most one team per league at a time. Prisma can't
-- express a partial unique index, so it lives here.
CREATE UNIQUE INDEX "RosterEntry_current_owner_key"
  ON "RosterEntry" ("leagueId", "playerId")
  WHERE "releasedAt" IS NULL;
