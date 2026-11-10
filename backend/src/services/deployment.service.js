import { prisma } from '../db/index.js';
import { runPipeline } from '../generator/pipeline.service.js';
import { k8sErrorMessage, listRunningApps } from '../kubernetes/k8s.client.js';
import { toDeploymentDto } from '../models/dto.mapper.js';
import { AppError, NotFoundError } from '../utils/AppError.js';
import { appNamespace } from '../utils/appNames.js';
import { createLogger } from '../utils/logger.js';
import { parseGithubUrl, pickSlug } from '../utils/repoUrl.js';

const log = createLogger('deployments');

// FR-9: the laptop fits 3 apps (P0 memory measurements, PQ5)
export const MAX_RUNNING_APPS = 3;

// A "deployment" in the API is one PipelineRun. Posting a repo that's already
// an app adds a new run to that app instead of making a second app.
export async function createDeployment(repoUrl) {
  const { owner, repo } = parseGithubUrl(repoUrl);
  const existing = await findApp(owner, repo);

  // refused before anything is created or cloned (FR-9)
  await checkAppLimit(existing?.id);

  const app = existing ?? (await createApp(owner, repo));
  const run = await prisma.pipelineRun.create({
    data: { appId: app.id },
    include: { app: true },
  });

  // don't await - cloning and building take a while and the frontend polls for
  // progress. runPipeline catches its own errors, this catch is just so a db
  // outage doesn't turn into an unhandled rejection that kills the process
  runPipeline(run.id).catch((err) => log.error(`pipeline for ${run.id} blew up`, err));

  return toDeploymentDto(run);
}

function findApp(owner, repo) {
  return prisma.app.findFirst({
    where: { repoFullName: { equals: `${owner}/${repo}`, mode: 'insensitive' }, deletedAt: null },
  });
}

async function createApp(owner, repo) {
  const slug = await pickSlug(owner, repo, async (s) =>
    Boolean(await prisma.app.findUnique({ where: { slug: s }, select: { id: true } })),
  );
  return prisma.app.create({
    data: { repoFullName: `${owner}/${repo}`, slug, namespace: appNamespace(slug) },
  });
}

// Apps that count: those with pods in the cluster, plus those with a run still
// going (it will have pods soon). Redeploying an app that already counts is fine.
export async function checkAppLimit(appId) {
  let running;
  try {
    running = await listRunningApps();
  } catch (err) {
    throw new AppError(`Can't check the app limit: the cluster isn't reachable (${k8sErrorMessage(err)})`, 503);
  }

  const counted = new Set();
  const slugs = running.map((r) => r.name);
  if (slugs.length) {
    const apps = await prisma.app.findMany({
      where: { slug: { in: slugs }, deletedAt: null },
      select: { id: true },
    });
    for (const a of apps) counted.add(a.id);
  }
  const inFlight = await prisma.pipelineRun.findMany({
    where: { finishedAt: null },
    select: { appId: true },
  });
  for (const r of inFlight) counted.add(r.appId);

  if (appId) counted.delete(appId);
  if (counted.size >= MAX_RUNNING_APPS) {
    throw new AppError(
      `Limit of ${MAX_RUNNING_APPS} running apps reached. Delete one before adding another.`,
      409,
    );
  }
}

export async function getDeployment(id) {
  const run = await prisma.pipelineRun.findUnique({
    where: { id },
    include: { app: true, files: true },
  });
  if (!run) throw new NotFoundError('Deployment');
  return toDeploymentDto(run);
}

export async function listDeployments(limit = 20) {
  const runs = await prisma.pipelineRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: { app: true },
  });
  return runs.map(toDeploymentDto);
}
