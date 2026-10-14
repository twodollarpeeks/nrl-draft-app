-- CreateTable
CREATE TABLE "MockDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "teamCount" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "pickSeconds" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "picks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MockDraft_userId_createdAt_idx" ON "MockDraft"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "MockDraft" ADD CONSTRAINT "MockDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
