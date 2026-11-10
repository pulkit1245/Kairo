import { env } from '../config/env.config.js';
import { prisma } from '../db/index.js';
import { runPipeline } from '../generator/pipeline.service.js';
import { toDeploymentDto } from '../models/dto.mapper.js';
import { NotFoundError } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';
import { parseGithubUrl, pickSlug } from '../utils/repoUrl.js';

const log = createLogger('deployments');

// A "deployment" in the API is one PipelineRun. Posting a repo that's already
// an app adds a new run to that app instead of making a second app.
export async function createDeployment(repoUrl) {
  const { owner, repo } = parseGithubUrl(repoUrl);
  const app = await findOrCreateApp(owner, repo);

  const run = await prisma.pipelineRun.create({
    data: { appId: app.id },
    include: { app: true },
  });

  // don't await - cloning can take a while and the frontend polls for progress.
  // runPipeline catches its own errors, this catch is just so a db outage
  // doesn't turn into an unhandled rejection that kills the process
  runPipeline(run.id).catch((err) => log.error(`pipeline for ${run.id} blew up`, err));

  return toDeploymentDto(run);
}

async function findOrCreateApp(owner, repo) {
  const repoFullName = `${owner}/${repo}`;
  const existing = await prisma.app.findFirst({
    where: { repoFullName: { equals: repoFullName, mode: 'insensitive' }, deletedAt: null },
  });
  if (existing) return existing;

  const slug = await pickSlug(owner, repo, async (s) =>
    Boolean(await prisma.app.findUnique({ where: { slug: s }, select: { id: true } })),
  );

  // P0: every app shares one namespace. P1 moves each app to kairo-<slug> (FR-29)
  return prisma.app.create({
    data: { repoFullName, slug, namespace: env.kubeNamespace },
  });
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
