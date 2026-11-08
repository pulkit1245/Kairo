-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('CLONING', 'DETECTING', 'GENERATING', 'BUILDING', 'DEPLOYING', 'RUNNING', 'FAILED');

-- CreateEnum
CREATE TYPE "Stack" AS ENUM ('NODE', 'PYTHON');

-- CreateEnum
CREATE TYPE "RemediationAction" AS ENUM ('RESTART', 'ROLLBACK', 'SCALE', 'NONE');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'CLONING',
    "stack" "Stack",
    "commitSha" TEXT,
    "failureReason" TEXT,
    "configs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT,
    "appName" TEXT NOT NULL,
    "alertName" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "action" "RemediationAction" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "fingerprint" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deployment_appName_idx" ON "Deployment"("appName");

-- CreateIndex
CREATE INDEX "Incident_fingerprint_status_idx" ON "Incident"("fingerprint", "status");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
