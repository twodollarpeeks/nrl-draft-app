-- AlterTable
ALTER TABLE "League" ADD COLUMN     "draftAt" TIMESTAMP(3),
ADD COLUMN     "draftOrder" TEXT[],
ADD COLUMN     "draftOrderLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "draftOrderMode" TEXT NOT NULL DEFAULT 'randomWhenFull';

-- The halves/hookers slot is "HF/HK" (halfback, five-eighth, hooker).
UPDATE "League"
SET settings = replace(settings::text, '"label": "HB/HK"', '"label": "HF/HK"')::jsonb
WHERE settings::text LIKE '%"label": "HB/HK"%';

-- Leagues already part-way through setup keep drawing their order at the start.
CREATE INDEX "League_draftAt_idx" ON "League" ("draftAt") WHERE status = 'setup';
