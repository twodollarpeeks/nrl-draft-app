-- AlterTable
ALTER TABLE "League" ADD COLUMN     "firstRound" INTEGER;

-- CreateTable
CREATE TABLE "Lineup" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "starters" JSONB NOT NULL,
    "bench" INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Lineup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Matchup" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,

    CONSTRAINT "Matchup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lineup_leagueId_round_idx" ON "Lineup"("leagueId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "Lineup_teamId_round_key" ON "Lineup"("teamId", "round");

-- CreateIndex
CREATE INDEX "Matchup_leagueId_round_idx" ON "Matchup"("leagueId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "Matchup_leagueId_round_homeTeamId_key" ON "Matchup"("leagueId", "round", "homeTeamId");

-- AddForeignKey
ALTER TABLE "Lineup" ADD CONSTRAINT "Lineup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lineup" ADD CONSTRAINT "Lineup_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matchup" ADD CONSTRAINT "Matchup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matchup" ADD CONSTRAINT "Matchup_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matchup" ADD CONSTRAINT "Matchup_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
