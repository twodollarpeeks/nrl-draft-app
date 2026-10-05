-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'snake',
    "status" TEXT NOT NULL,
    "pickSeconds" INTEGER NOT NULL,
    "order" TEXT[],
    "totalPicks" INTEGER NOT NULL,
    "currentPick" INTEGER NOT NULL DEFAULT 1,
    "deadline" TIMESTAMP(3),
    "pausedRemainingMs" INTEGER,
    "autopilotTeamIds" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPick" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "pickNo" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "madeBy" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftQueueItem" (
    "draftId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "DraftQueueItem_pkey" PRIMARY KEY ("draftId","teamId","playerId")
);

-- CreateTable
CREATE TABLE "RosterEntry" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "acquiredVia" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "RosterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Draft_leagueId_key" ON "Draft"("leagueId");

-- CreateIndex
CREATE INDEX "Draft_status_idx" ON "Draft"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_draftId_pickNo_key" ON "DraftPick"("draftId", "pickNo");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_draftId_playerId_key" ON "DraftPick"("draftId", "playerId");

-- CreateIndex
CREATE INDEX "DraftQueueItem_draftId_teamId_rank_idx" ON "DraftQueueItem"("draftId", "teamId", "rank");

-- CreateIndex
CREATE INDEX "RosterEntry_teamId_idx" ON "RosterEntry"("teamId");

-- CreateIndex
CREATE INDEX "RosterEntry_leagueId_playerId_idx" ON "RosterEntry"("leagueId", "playerId");

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftQueueItem" ADD CONSTRAINT "DraftQueueItem_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftQueueItem" ADD CONSTRAINT "DraftQueueItem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftQueueItem" ADD CONSTRAINT "DraftQueueItem_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
