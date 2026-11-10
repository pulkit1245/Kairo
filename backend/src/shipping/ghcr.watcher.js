import { prisma } from '../db/index.js';
import { getBranchHead, githubErrorMessage } from '../github/github.client.js';
import { isRolloutInProgress } from '../state/rollout.state.js';
import { IN_PROGRESS_STATUSES } from '../types/index.js';
import { ghcrImage } from '../utils/appNames.js';
import { errorMessage } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';
import { findImage } from './ghcr.client.js';
import { inGrace } from './grace.service.js';
import { rollOut } from './rollout.service.js';

// The GHCR watcher (FR-35), every 30 s (src/index.js). GitHub can't reach the
// laptop, so Kairo polls. For each app whose setup PR is merged:
//
//   1. the newest commit on the default branch (installation token, FR-5)
//   2. skip it if it is the running release, or a rollout of it already failed
//      (FR-36: a failed commit is never retried)
//   3. is ghcr.io/<repo>:<sha> there for amd64 and arm64? (anonymous, like the
//      cluster's own pull)
//   4. if so, roll it out (rollout.service.js)
//
// An app is left alone while it is rolling out or in the grace window after a
// rollout, so each release gets its healthy check before the next one (FR-37).

const log = createLogger('ghcr');

export const WATCH_INTERVAL_MS = 30_000;

// what was last said about each app, so a 30 s poll doesn't repeat it
const lastSaid = new Map(); // slug -> message

function sayOnce(slug, message) {
  if (lastSaid.get(slug) === message) return;
  lastSaid.set(slug, message);
  log.info(`${slug}: ${message}`);
}

export async function checkGhcr() {
  const apps = await prisma.app.findMany({
    where: { deletedAt: null, prState: 'MERGED', defaultBranch: { not: null }, installation: { suspendedAt: null } },
    include: {
      installation: true,
      releases: { where: { status: 'ACTIVE' }, orderBy: { deployedAt: 'desc' }, take: 1 },
    },
  });
  const results = [];
  for (const app of apps) {
    try {
      results.push({ slug: app.slug, ...(await checkApp(app)) });
    } catch (err) {
      const msg = err?.status ? githubErrorMessage(err) : errorMessage(err);
      log.warn(`${app.slug}: GHCR check failed: ${msg}`);
      results.push({ slug: app.slug, state: 'error', detail: msg });
    }
  }
  return results;
}

/** @returns {Promise<{ state: string, detail?: string }>} */
// deps are parameters so the unit test can fake GitHub, GHCR, the rollout and the database
export async function checkApp(app, deps = { getBranchHead, findImage, rollOut, db: prisma }) {
  if (isRolloutInProgress(app.slug)) return { state: 'busy', detail: 'rolling out' };
  if (inGrace(app.slug)) return { state: 'busy', detail: 'in its grace window' };
  const active = app.releases[0];
  if (!active) {
    sayOnce(app.slug, 'no running release to roll out over; deploy it again first');
    return { state: 'no-release' };
  }
  const running = await deps.db.pipelineRun.count({
    where: { appId: app.id, finishedAt: null, status: { in: [...IN_PROGRESS_STATUSES] } },
  });
  if (running) return { state: 'busy', detail: 'a pipeline run is going' };

  const [owner, repo] = app.repoFullName.split('/');
  const head = await deps.getBranchHead(app.installation.githubInstallationId, owner, repo, app.defaultBranch);
  const short = head.sha.slice(0, 7);
  if (active.commitSha === head.sha) return { state: 'current' };

  const tried = await deps.db.release.findFirst({
    where: { appId: app.id, commitSha: head.sha, source: 'GHCR' },
    orderBy: { deployedAt: 'desc' },
  });
  if (tried?.status === 'FAILED') {
    sayOnce(app.slug, `${short} failed to roll out before; waiting for a newer commit`);
    return { state: 'failed-before' };
  }
  if (tried) return { state: 'current' }; // rolled out, then replaced by a rollback (P3)

  const repoImage = ghcrImage(app.repoFullName);
  const image = await deps.findImage(app.repoFullName, head.sha);
  if (!image.found) {
    sayOnce(app.slug, `waiting for ${repoImage.replace('ghcr.io/', '')}:${short} (${image.detail})`);
    return { state: 'waiting', detail: image.detail };
  }
  if (image.missing.length) {
    // the workflow builds both; a partial image is waited on, never rolled out
    sayOnce(app.slug, `${short} is in GHCR without ${image.missing.join(' and ')}; not rolling it out`);
    return { state: 'waiting', detail: `missing ${image.missing.join(', ')}` };
  }

  sayOnce(app.slug, `${short} is in GHCR for ${image.platforms.join(' and ')}`);
  // not awaited: a 3-minute rollout mustn't hold up the other apps' checks.
  // The rollout lock makes the next tick skip this app meanwhile.
  deps
    .rollOut(
      { id: app.id, slug: app.slug, namespace: app.namespace },
      { commitSha: head.sha, commitMessage: head.message, imageRef: `${repoImage}:${head.sha}` },
    )
    .catch((err) => log.error(`${app.slug}: rollout of ${short} failed`, err));
  return { state: 'rolling-out' };
}

// for tests
export const _resetWatcher = () => lastSaid.clear();
