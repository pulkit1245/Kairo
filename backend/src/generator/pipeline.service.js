import { env } from '../config/env.config.js';
import { prisma } from '../db/index.js';
import { IN_PROGRESS_STATUSES } from '../types/index.js';
import { AppError, errorMessage } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';
import { cloneRepo } from './clone/clone.service.js';
import { detectStack } from './detection/detection.service.js';
import { generateConfigs } from './template/config.service.js';

const log = createLogger('pipeline');

// Runs in the background after POST /deployments returns.
// The frontend polls GET /deployments/:id and follows the status.
export async function runPipeline(deploymentId) {
  const deployment = await prisma.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
  const started = Date.now();

  try {
    await moveTo(deploymentId, 'CLONING');
    const { dir, commitSha } = await cloneRepo(deployment.repoUrl, deploymentId, {
      workspaceDir: env.workspaceDir,
      timeoutMs: env.cloneTimeoutMs,
    });
    log.info(`${deployment.appName}: cloned @ ${commitSha.slice(0, 7)}`);

    await moveTo(deploymentId, 'DETECTING', { commitSha });
    const detected = await detectStack(dir);
    log.info(`${deployment.appName}: looks like ${detected.stack}`);

    await moveTo(deploymentId, 'GENERATING', { stack: detected.stack });
    const configs = generateConfigs({
      deploymentId,
      appName: deployment.appName,
      commitSha,
      namespace: env.kubeNamespace,
      detected,
    });
    await prisma.deployment.update({ where: { id: deploymentId }, data: { configs } });

    // TODO(phase 2): BUILDING  -> docker build with Docker Desktop's engine (kubeadm sees local images)
    //                DEPLOYING -> apply the manifests with the k8s client
    //                RUNNING   -> once the rollout is ready
    // until then the deployment just stops at GENERATING with its configs filled in
    log.info(`${deployment.appName}: configs ready in ${Date.now() - started}ms`);
  } catch (err) {
    const reason = err instanceof AppError ? err.message : `Unexpected error: ${errorMessage(err)}`;
    log.warn(`${deployment.appName}: failed - ${reason}`);
    if (!(err instanceof AppError)) log.error('pipeline crashed', err);

    await moveTo(deploymentId, 'FAILED', { failureReason: reason });
  }
}

function moveTo(id, status, extra = {}) {
  return prisma.deployment.update({ where: { id }, data: { ...extra, status } });
}

// If the server dies halfway through a pipeline the row stays in CLONING etc.
// forever and the stepper on the frontend spins forever. Clean those up on boot.
export async function failInterruptedDeployments() {
  const { count } = await prisma.deployment.updateMany({
    where: { status: { in: [...IN_PROGRESS_STATUSES] } },
    data: { status: 'FAILED', failureReason: 'Interrupted - the backend restarted mid-deploy' },
  });
  return count;
}
