import { prisma } from '../db/index.js';
import { githubErrorMessage, isInstallationGone, listInstallationRepos } from '../github/github.client.js';
import { AppError } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';
import { countedApps, markSuspended, MAX_RUNNING_APPS, PRIVATE_REPO_MESSAGE } from './deployment.service.js';

const log = createLogger('repos');

// The repo picker (FR-3, FR-6): every repo the user's installations can see,
// newest push first, with the Kairo app it already is (if any).
export async function listRepos(userId) {
  const installations = await prisma.installation.findMany({
    where: { userId, suspendedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  const outInstallations = [];
  const repos = [];
  for (const inst of installations) {
    let list;
    try {
      list = await listInstallationRepos(inst.githubInstallationId);
    } catch (err) {
      if (isInstallationGone(err)) {
        // uninstalled on GitHub: stop using it (PRD section 8)
        log.warn(`installation on ${inst.accountLogin} is gone, marked suspended`);
        await markSuspended(inst.id);
        continue;
      }
      throw new AppError(`GitHub didn't answer: ${githubErrorMessage(err)}`, 502);
    }
    outInstallations.push({ id: inst.id, accountLogin: inst.accountLogin, repoCount: list.length });
    for (const r of list) repos.push({ ...r, installationId: inst.id });
  }

  // same repo through two installations: keep the first
  const unique = [...new Map(repos.map((r) => [r.fullName.toLowerCase(), r])).values()];

  const apps = unique.length
    ? await prisma.app.findMany({
        where: { deletedAt: null, OR: unique.map((r) => ({ repoFullName: { equals: r.fullName, mode: 'insensitive' } })) },
        select: { id: true, slug: true, repoFullName: true },
      })
    : [];
  const appFor = new Map(apps.map((a) => [a.repoFullName.toLowerCase(), a]));

  return {
    installations: outInstallations,
    repos: unique
      .sort((a, b) => String(b.pushedAt ?? '').localeCompare(String(a.pushedAt ?? '')))
      .map((r) => {
        const app = appFor.get(r.fullName.toLowerCase());
        return {
          ...r,
          disabledReason: r.private ? PRIVATE_REPO_MESSAGE : null,
          app: app ? { id: app.id, slug: app.slug } : null,
        };
      }),
    limit: { running: await runningCount(), max: MAX_RUNNING_APPS },
  };
}

// null when the cluster can't be reached; the picker still works
async function runningCount() {
  try {
    return (await countedApps()).size;
  } catch {
    return null;
  }
}
