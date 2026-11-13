-- Waivers, trades, and handing a team to a new manager.
-- AlterTable
ALTER TABLE "League" ADD COLUMN     "waiverOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "handoverCode" TEXT;

-- CreateTable
CREATE TABLE "WaiverClaim" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "dropPlayerId" INTEGER,
    "rank" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WaiverClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "proposerTeamId" TEXT NOT NULL,
    "receiverTeamId" TEXT NOT NULL,
    "givePlayerIds" INTEGER[],
    "getPlayerIds" INTEGER[],
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "reviewEndsAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeVote" (
    "tradeId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "approve" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeVote_pkey" PRIMARY KEY ("tradeId","teamId")
);

-- CreateIndex
CREATE INDEX "WaiverClaim_leagueId_status_idx" ON "WaiverClaim"("leagueId", "status");

-- CreateIndex
CREATE INDEX "Trade_leagueId_status_idx" ON "Trade"("leagueId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Team_handoverCode_key" ON "Team"("handoverCode");

-- AddForeignKey
ALTER TABLE "WaiverClaim" ADD CONSTRAINT "WaiverClaim_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_proposerTeamId_fkey" FOREIGN KEY ("proposerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_receiverTeamId_fkey" FOREIGN KEY ("receiverTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeVote" ADD CONSTRAINT "TradeVote_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeVote" ADD CONSTRAINT "TradeVote_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

