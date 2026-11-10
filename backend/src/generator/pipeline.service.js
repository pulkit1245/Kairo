import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAllYaml } from '@kubernetes/client-node';
import { env } from '../config/env.config.js';
import { prisma } from '../db/index.js';
import {
  applyObjects,
  ensureNamespace,
  k8sErrorMessage,
  putAlertRules,
  waitForRollout,
} from '../kubernetes/k8s.client.js';
import { startGrace } from '../shipping/grace.service.js';
import { pruneImages } from '../shipping/prune.service.js';
import { beginRollout, endRollout } from '../state/rollout.state.js';
import { IN_PROGRESS_STATUSES } from '../types/index.js';
import { AppError, errorMessage } from '../utils/AppError.js';
import { appImage, appNamespace } from '../utils/appNames.js';
import { createLogger } from '../utils/logger.js';
import { cloneUrlFor } from '../utils/repoUrl.js';
import { cloneRepo } from './clone/clone.service.js';
import { buildImage } from './deploy/build.service.js';
import { detectStack } from './detection/detection.service.js';
import { generateConfigs } from './template/config.service.js';

const log = createLogger('pipeline');

// FR-29: how long a new deploy has to become ready
export const READY_TIMEOUT_MS = 3 * 60 * 1000;

// A step failure the run records as-is. logTail is extra lines (the build log)
// stored after the reason.
class StepError extends AppError {
  constructor(message, logTail = []) {
    super(message);
    this.logTail = logTail;
  }
}

// errorLog layout (decided 10 Nov): first line is the readable reason, the
// lines after it are the log tail. The API splits it again (dto.mapper.js).
export function toErrorLog(reason, logTail = []) {
  const oneLine = reason.replace(/\s*\n\s*/g, ' ');
  return logTail.length ? `${oneLine}\n${logTail.join('\n')}` : oneLine;
}

// Runs in the background after POST /deployments returns.
// The frontend polls GET /deployments/:id and follows the status.
//   CLONING -> DETECTING -> GENERATING -> BUILDING -> DEPLOYING -> RUNNING
export async function runPipeline(runId) {
  const run = await prisma.pipelineRun.findUniqueOrThrow({
    where: { id: runId },
    include: { app: true },
  });
  const { app } = run;
  const started = Date.now();
  // which step we're on, so a failure can say where it happened
  let step = 'CLONING';
  let dir = null;
  let applied = null; // { imageRef, commitSha, commitMessage } once objects are in the cluster

  try {
    await moveTo(runId, step);
    const cloned = await cloneRepo(cloneUrlFor(app.repoFullName), runId, {
      workspaceDir: env.workspaceDir,
      timeoutMs: env.cloneTimeoutMs,
    });
    dir = cloned.dir;
    const { commitSha, branch, commitMessage } = cloned;
    log.info(`${app.slug}: cloned ${branch} @ ${commitSha.slice(0, 7)}`);

    step = 'DETECTING';
    await moveTo(runId, step, { commitSha });
    await prisma.app.update({ where: { id: app.id }, data: { defaultBranch: branch } });
    const detected = await detectStack(dir);
    log.info(`${app.slug}: looks like ${detected.stack ?? 'an unknown stack'}${detected.existingDockerfile ? ', keeping its Dockerfile' : ''}`);

    step = 'GENERATING';
    await moveTo(runId, step);
    const namespace = appNamespace(app.slug);
    await prisma.app.update({ where: { id: app.id }, data: { stack: detected.stack, namespace } });
    // throws an AppError if a rendered file fails its checks (FR-26)
    const files = generateConfigs({
      pipelineRunId: runId,
      appName: app.slug,
      commitSha,
      namespace,
      repoFullName: app.repoFullName,
      defaultBranch: branch,
      detected,
    });
    await prisma.generatedFile.createMany({
      data: files.map((f) => ({ ...f, pipelineRunId: runId })),
    });
    const byKind = Object.fromEntries(files.map((f) => [f.kind, f]));

    step = 'BUILDING';
    await moveTo(runId, step);
    const imageRef = appImage(app.slug, commitSha);
    // a kept Dockerfile is built where it is (FR-25). A generated one sits next
    // to the clone, not in it, so the build context is exactly the repo.
    // .git isn't needed any more
    const kept = byKind.DOCKERFILE.origin === 'KEPT_EXISTING';
    const dockerfile = kept ? path.join(dir, 'Dockerfile') : `${dir}.Dockerfile`;
    if (!kept) await writeFile(dockerfile, byKind.DOCKERFILE.content);
    await rm(path.join(dir, '.git'), { recursive: true, force: true });
    const build = await buildImage({ contextDir: dir, dockerfile, tag: imageRef });
    if (!build.ok) throw new StepError(build.reason, build.logTail);
    log.info(`${app.slug}: built ${imageRef.slice(0, imageRef.indexOf(':') + 8)}`);

    step = 'DEPLOYING';
    await moveTo(runId, step);
    // remediation leaves the app alone until this run ends (FR-74)
    beginRollout(app.slug);
    await ensureNamespace(namespace, {
      'app.kubernetes.io/managed-by': 'kairo',
      app: app.slug,
    });
    const objects = ['DEPLOYMENT', 'SERVICE', 'INGRESS'].map((k) => loadAllYaml(byKind[k].content)[0]);
    await applyObjects(objects);
    applied = { imageRef, commitSha, commitMessage };

    const rollout = await waitForRollout(namespace, app.slug, { timeoutMs: READY_TIMEOUT_MS });
    if (!rollout.ready) {
      const why = rollout.detail ? ` (${rollout.detail})` : '';
      throw new StepError(
        `App didn't answer on $PORT (${detected.port}) within ${READY_TIMEOUT_MS / 60000} minutes${why}`,
      );
    }

    // only a ready app gets alert rules: rules on a broken preview would fire
    // for something that never worked
    await putAlertRules(app.slug, byKind.ALERT_RULES.content);
    const release = await recordRelease(app.id, applied, 'ACTIVE');
    await prisma.app.update({ where: { id: app.id }, data: { replicas: 1 } });
    // FR-71: every rollout, the preview included, starts a grace window. At its
    // end the release is marked healthy or not, and a healthy preview of a
    // picked repo gets its PR (FR-30, generator/pr via the hook in src/index.js)
    startGrace(release, { ...app, namespace });
    // FR-38: only the last 3 releases keep their image
    await pruneImages(app.id);

    await moveTo(runId, 'RUNNING', { finishedAt: new Date() });
    log.info(`${app.slug}: RUNNING in ${Math.round((Date.now() - started) / 1000)} s`);
  } catch (err) {
    const known = err instanceof AppError;
    const reason = known ? err.message : `Unexpected error: ${k8sErrorMessage(err)}`;
    log.warn(`${app.slug}: failed at ${step} - ${reason}`);
    if (!known) log.error('pipeline crashed', err);

    // an image that reached the cluster but never became ready is a failed release
    if (applied) await recordRelease(app.id, applied, 'FAILED').catch((e) => log.error('could not record failed release', e));

    await moveTo(runId, 'FAILED', {
      failedStep: step,
      errorLog: toErrorLog(reason, err.logTail),
      finishedAt: new Date(),
    });
  } finally {
    endRollout(app.slug);
    // FR-10: the clone never outlives the run, success or failure
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch((e) => log.warn(`could not delete ${dir}: ${errorMessage(e)}`));
      await rm(`${dir}.Dockerfile`, { force: true }).catch(() => {});
    }
  }
}

// A new ACTIVE release supersedes the previous ACTIVE one; a FAILED one changes
// nothing else. Returns the new release.
async function recordRelease(appId, { imageRef, commitSha, commitMessage }, status) {
  const data = { appId, imageRef, commitSha, commitMessage, source: 'PREVIEW', status };
  if (status !== 'ACTIVE') return prisma.release.create({ data });
  const [, release] = await prisma.$transaction([
    prisma.release.updateMany({ where: { appId, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } }),
    prisma.release.create({ data }),
  ]);
  return release;
}

function moveTo(id, status, extra = {}) {
  return prisma.pipelineRun.update({ where: { id }, data: { ...extra, status } });
}

// If the server dies halfway through a pipeline the row never gets a finishedAt
// and the stepper on the frontend spins forever. Clean those up on boot.
// Only finishedAt decides: a run that stopped for good is finished, not interrupted.
// A run already in a final state (FAILED, RUNNING) is never touched, even with
// no finishedAt: rows written before finishedAt existed would otherwise lose
// their real failure reason.
// db is a parameter so the unit test can fake it
export async function failInterruptedRuns(db = prisma) {
  const stuck = await db.pipelineRun.findMany({
    where: { finishedAt: null, status: { in: [...IN_PROGRESS_STATUSES] } },
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

// FR-10 after a crash: a run cut off mid-way never reached its finally block,
// so its clone is still there. Nothing else lives in the workspace, and no run
// is going at boot, so everything in it can go.
export async function emptyWorkspace(dir = env.workspaceDir) {
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    return 0; // no workspace yet
  }
  await Promise.all(entries.map((e) => rm(path.join(dir, e), { recursive: true, force: true })));
  return entries.length;
}
