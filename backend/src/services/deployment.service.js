import { runPipeline } from '../generator/pipeline.service.js';
import { toDeploymentDto } from '../models/dto.mapper.js';
import { prisma } from '../db/index.js';
import { NotFoundError } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';
import { parseGithubUrl, toAppName } from '../utils/repoUrl.js';

const log = createLogger('deployments');

export async function createDeployment(repoUrl) {
  const { repo, cloneUrl } = parseGithubUrl(repoUrl);

  const row = await prisma.deployment.create({
    data: { repoUrl: cloneUrl, appName: toAppName(repo) },
  });

  // don't await - cloning can take a while and the frontend polls for progress.
  // runPipeline catches its own errors, this catch is just so a db outage
  // doesn't turn into an unhandled rejection that kills the process
  runPipeline(row.id).catch((err) => log.error(`pipeline for ${row.id} blew up`, err));

  return toDeploymentDto(row);
}

export async function getDeployment(id) {
  const row = await prisma.deployment.findUnique({ where: { id } });
  if (!row) throw new NotFoundError('Deployment');
  return toDeploymentDto(row);
}

export async function listDeployments(limit = 20) {
  const rows = await prisma.deployment.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(toDeploymentDto);
}
