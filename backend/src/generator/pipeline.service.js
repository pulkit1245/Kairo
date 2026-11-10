import { env } from '../config/env.config.js';
import { prisma } from '../db/index.js';
import { AppError, errorMessage } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';
import { cloneUrlFor } from '../utils/repoUrl.js';
import { cloneRepo } from './clone/clone.service.js';
import { detectStack } from './detection/detection.service.js';
import { generateConfigs } from './template/config.service.js';

const log = createLogger('pipeline');

// Runs in the background after POST /deployments returns.
// The frontend polls GET /deployments/:id and follows the status.
export async function runPipeline(runId) {
  const run = await prisma.pipelineRun.findUniqueOrThrow({
    where: { id: runId },
    include: { app: true },
  });
  const { app } = run;
  const started = Date.now();
  // which step we're on, so a failure can say where it happened
  let step = 'CLONING';

  try {
    await moveTo(runId, step);
    const { dir, commitSha, branch } = await cloneRepo(cloneUrlFor(app.repoFullName), runId, {
      workspaceDir: env.workspaceDir,
      timeoutMs: env.cloneTimeoutMs,
    });
    log.info(`${app.slug}: cloned ${branch} @ ${commitSha.slice(0, 7)}`);

    step = 'DETECTING';
    await moveTo(runId, step, { commitSha });
    await prisma.app.update({ where: { id: app.id }, data: { defaultBranch: branch } });
    const detected = await detectStack(dir);
    log.info(`${app.slug}: looks like ${detected.stack}`);

    step = 'GENERATING';
    await moveTo(runId, step);
    await prisma.app.update({ where: { id: app.id }, data: { stack: detected.stack } });
    const files = generateConfigs({
      pipelineRunId: runId,
      appName: app.slug,
      commitSha,
      namespace: app.namespace,
      detected,
    });
    await prisma.generatedFile.createMany({
      data: files.map((f) => ({ ...f, pipelineRunId: runId })),
    });

    // TODO(P1): BUILDING  -> docker build with Docker Desktop's engine (the cluster sees local images)
    //           DEPLOYING -> apply the manifests with the k8s client
    //           RUNNING   -> once the rollout is ready
    // until then the run stops at GENERATING with its files saved. finishedAt
    // is what says "this run is over", so a restart leaves it alone (FR-7)
    await finish(runId);
    log.info(`${app.slug}: files ready in ${Date.now() - started}ms`);
  } catch (err) {
    const reason = err instanceof AppError ? err.message : `Unexpected error: ${errorMessage(err)}`;
    log.warn(`${app.slug}: failed at ${step} - ${reason}`);
    if (!(err instanceof AppError)) log.error('pipeline crashed', err);

    await moveTo(runId, 'FAILED', { failedStep: step, errorLog: reason, finishedAt: new Date() });
  }
}

function finish(id) {
  return prisma.pipelineRun.update({ where: { id }, data: { finishedAt: new Date() } });
}

function moveTo(id, status, extra = {}) {
  return prisma.pipelineRun.update({ where: { id }, data: { ...extra, status } });
}

// If the server dies halfway through a pipeline the row never gets a finishedAt
// and the stepper on the frontend spins forever. Clean those up on boot.
// Only finishedAt decides: a run that stopped at GENERATING (the last step in P0)
// is finished, not interrupted. db is a parameter so the unit test can fake it
export async function failInterruptedRuns(db = prisma) {
  const stuck = await db.pipelineRun.findMany({
    where: { finishedAt: null },
    select: { id: true, status: true },
  });

  const now = new Date();
  for (const run of stuck) {
    await db.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        failedStep: run.status,
        errorLog: 'Interrupted - the backend restarted mid-deploy',
        finishedAt: now,
      },
    });
  }
  return stuck.length;
}
