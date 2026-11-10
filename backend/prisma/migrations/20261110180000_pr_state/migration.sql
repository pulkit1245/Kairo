-- P2b: the PR's state becomes a fixed list (FR-34, AQ11), plus why it failed.
-- A cast, not drop-and-add, so any existing value would survive.

-- CreateEnum
CREATE TYPE "PrState" AS ENUM ('OPEN', 'MERGED', 'CLOSED', 'FAILED');

-- AlterTable
ALTER TABLE "App" ALTER COLUMN "prState" TYPE "PrState" USING "prState"::"PrState";
ALTER TABLE "App" ADD COLUMN "prError" TEXT;
