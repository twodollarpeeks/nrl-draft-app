/*
  Warnings:

  - You are about to drop the column `byeClubIds` on the `Round` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Round" DROP COLUMN "byeClubIds",
ADD COLUMN     "byeClubKeys" TEXT[];
