-- Replaces the phase-1 Deployment/Incident tables with the 8 entities from PRD section 7.
-- Local data was dropped on purpose (agreed 10 Nov), so nothing is copied across.
-- DeploymentStatus, Stack and IncidentStatus come from the init migration and are unchanged.

-- DropTable
DROP TABLE "Incident";
DROP TABLE "Deployment";

-- DropEnum (SCALE splits into SCALE_UP and SCALE_DOWN)
DROP TYPE "RemediationAction";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AppHealth" AS ENUM ('HEALTHY', 'HEALING', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "GeneratedFileKind" AS ENUM ('DOCKERFILE', 'DEPLOYMENT', 'SERVICE', 'INGRESS', 'WORKFLOW', 'ALERT_RULES');

-- CreateEnum
CREATE TYPE "FileOrigin" AS ENUM ('GENERATED', 'KEPT_EXISTING');

-- CreateEnum
CREATE TYPE "ReleaseSource" AS ENUM ('PREVIEW', 'GHCR');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'ROLLED_BACK', 'FAILED');

-- CreateEnum
CREATE TYPE "RemediationAction" AS ENUM ('RESTART', 'ROLLBACK', 'SCALE_UP', 'SCALE_DOWN', 'NONE');

-- CreateEnum
CREATE TYPE "AttemptTrigger" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "AttemptResult" AS ENUM ('APPLIED', 'VERIFIED', 'UNVERIFIED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "githubId" INTEGER NOT NULL,
    "login" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "githubInstallationId" INTEGER NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt" TIMESTAMP(3),

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "installationId" TEXT,
    "repoFullName" TEXT NOT NULL,
    "defaultBranch" TEXT,
    "slug" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "stack" "Stack",
    "publicUrl" TEXT,
    "autoHeal" BOOLEAN NOT NULL DEFAULT true,
    "health" "AppHealth" NOT NULL DEFAULT 'HEALTHY',
    "replicas" INTEGER NOT NULL DEFAULT 1,
    "prNumber" INTEGER,
    "prState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "commitSha" TEXT,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'CLONING',
    "failedStep" "DeploymentStatus",
    "errorLog" TEXT,
    "explanation" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedFile" (
    "id" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "kind" "GeneratedFileKind" NOT NULL,
    "content" TEXT NOT NULL,
    "origin" "FileOrigin" NOT NULL DEFAULT 'GENERATED',
    "facts" JSONB,

    CONSTRAINT "GeneratedFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "imageRef" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "commitMessage" TEXT,
    "source" "ReleaseSource" NOT NULL,
    "status" "ReleaseStatus" NOT NULL,
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "healthyAt" TIMESTAMP(3),

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "alertName" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "cause" TEXT NOT NULL,
    "explanation" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "recoverySeconds" DOUBLE PRECISION,
    "githubIssueNumber" INTEGER,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemediationAttempt" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "action" "RemediationAction" NOT NULL,
    "trigger" "AttemptTrigger" NOT NULL DEFAULT 'AUTO',
    "dryRun" BOOLEAN NOT NULL,
    "result" "AttemptResult" NOT NULL,
    "fromReleaseId" TEXT,
    "toReleaseId" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "RemediationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");

-- CreateIndex
CREATE UNIQUE INDEX "Installation_githubInstallationId_key" ON "Installation"("githubInstallationId");

-- CreateIndex
CREATE UNIQUE INDEX "App_slug_key" ON "App"("slug");

-- CreateIndex
CREATE INDEX "App_repoFullName_idx" ON "App"("repoFullName");

-- CreateIndex
CREATE INDEX "PipelineRun_appId_startedAt_idx" ON "PipelineRun"("appId", "startedAt");

-- CreateIndex
CREATE INDEX "GeneratedFile_pipelineRunId_idx" ON "GeneratedFile"("pipelineRunId");

-- CreateIndex
CREATE INDEX "Release_appId_deployedAt_idx" ON "Release"("appId", "deployedAt");

-- CreateIndex
CREATE INDEX "Incident_fingerprint_status_idx" ON "Incident"("fingerprint", "status");

-- CreateIndex
CREATE INDEX "Incident_appId_startedAt_idx" ON "Incident"("appId", "startedAt");

-- CreateIndex
CREATE INDEX "RemediationAttempt_incidentId_idx" ON "RemediationAttempt"("incidentId");

-- AddForeignKey
ALTER TABLE "Installation" ADD CONSTRAINT "Installation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRun" ADD CONSTRAINT "PipelineRun_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedFile" ADD CONSTRAINT "GeneratedFile_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationAttempt" ADD CONSTRAINT "RemediationAttempt_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationAttempt" ADD CONSTRAINT "RemediationAttempt_fromReleaseId_fkey" FOREIGN KEY ("fromReleaseId") REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationAttempt" ADD CONSTRAINT "RemediationAttempt_toReleaseId_fkey" FOREIGN KEY ("toReleaseId") REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

