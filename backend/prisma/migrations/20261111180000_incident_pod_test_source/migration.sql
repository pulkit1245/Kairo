-- P3: the pod an alert named, and Break It's release source (FR-63).

-- AlterEnum
ALTER TYPE "ReleaseSource" ADD VALUE 'TEST';

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN "pod" TEXT;
