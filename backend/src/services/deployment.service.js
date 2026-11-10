import { prisma } from '../db/index.js';
import { getInstallationRepo, githubErrorMessage, isInstallationGone } from '../github/github.client.js';
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

// FR-6
export const PRIVATE_REPO_MESSAGE = "Private repos aren't supported yet";

// A "deployment" in the API is one PipelineRun. Posting a repo that's already
// an app adds a new run to that app instead of making a second app.
// Since P2 this is the hidden testing shortcut (AQ10): any public GitHub URL,
// behind sign-in. The UI onboards from the repo picker (onboardRepo below).
export async function createDeployment(repoUrl) {
  const { owner, repo } = parseGithubUrl(repoUrl);
  const existing = await findApp(owner, repo);

  // refused before anything is created or cloned (FR-9)
  await checkAppLimit(existing?.id);

  const app = existing ?? (await createApp(owner, repo));
  return startRun(app.id);
}

// FR-3: onboarding from a repo the user picked. The repo must be visible to
// one of their installations and public (FR-6).
export async function onboardRepo(userId, repoFullName) {
  const [owner, repo, ...rest] = String(repoFullName ?? '').split('/');
  // GitHub's own characters for names; "." and ".." aren't real names
  const valid = (s) => /^[\w.-]+$/.test(s) && !/^\.+$/.test(s);
  if (!owner || !repo || rest.length || !valid(owner) || !valid(repo)) {
    throw new AppError('repoFullName should look like owner/repo');
  }

  const found = await findInstalledRepo(userId, owner, repo);
  if (!found) {
    throw new AppError(`The Kairo GitHub App can't see ${owner}/${repo}. Give it access on GitHub first.`, 404);
  }
  if (found.repo.private) throw new AppError(PRIVATE_REPO_MESSAGE);

  const existing = await findApp(owner, repo);
  await checkAppLimit(existing?.id);

  const data = {
    installationId: found.installation.id,
    defaultBranch: found.repo.defaultBranch,
    repoFullName: found.repo.fullName,
  };
  const app = existing
    ? await prisma.app.update({ where: { id: existing.id }, data })
    : await createApp(owner, repo, data);
  return startRun(app.id);
}

// the first of the user's live installations that can see the repo
async function findInstalledRepo(userId, owner, repo) {
  const installations = await prisma.installation.findMany({
    where: { userId, suspendedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  for (const installation of installations) {
    let found;
    try {
      found = await getInstallationRepo(installation.githubInstallationId, owner, repo);
    } catch (err) {
      if (isInstallationGone(err)) {
        await markSuspended(installation.id);
        continue;
      }
      throw new AppError(`GitHub didn't answer: ${githubErrorMessage(err)}`, 502);
    }
    if (found) return { installation, repo: found };
  }
  return null;
}

async function startRun(appId) {
  const run = await prisma.pipelineRun.create({
    data: { appId },
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

async function createApp(owner, repo, extra = {}) {
  const slug = await pickSlug(owner, repo, async (s) =>
    Boolean(await prisma.app.findUnique({ where: { slug: s }, select: { id: true } })),
  );
  return prisma.app.create({
    data: { repoFullName: `${owner}/${repo}`, ...extra, slug, namespace: appNamespace(slug) },
  });
}

// Apps that count: those with pods in the cluster, plus those with a run still
// going (it will have pods soon). Redeploying an app that already counts is fine.
// Returns the set of counted app ids.
export async function countedApps() {
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
  return counted;
}

export async function checkAppLimit(appId) {
  const counted = await countedApps();
  if (appId) counted.delete(appId);
  if (counted.size >= MAX_RUNNING_APPS) {
    throw new AppError(
      `Limit of ${MAX_RUNNING_APPS} running apps reached. Delete one before adding another.`,
      409,
    );
  }
}

export const markSuspended = (installationId) =>
  prisma.installation.update({ where: { id: installationId }, data: { suspendedAt: new Date() } });

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
