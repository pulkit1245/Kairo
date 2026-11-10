import { prisma } from '../db/index.js';
import { k8sErrorMessage, setImage, waitForRollout } from '../kubernetes/k8s.client.js';
import { beginRollout, endRollout, isRolloutInProgress } from '../state/rollout.state.js';
import { errorMessage } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';
import { startGrace } from './grace.service.js';
import { pruneImages } from './prune.service.js';

// A GHCR rollout (FR-36, FR-37). The GHCR watcher finds a new image; this
// patches the Deployment to it and waits for the pods.
//
//   success -> new release ACTIVE, the previous one SUPERSEDED, grace window
//              starts (the release isn't healthy yet, FR-72), old images pruned
//   failure -> release FAILED, so the watcher never tries that commit again.
//              The rolling update keeps the old pod serving (maxUnavailable 0
//              with one replica); rolling back arrives in P3 (FR-50).
//
// One rollout per app at a time: the same in-memory lock the pipeline holds
// from DEPLOYING (src/state/rollout.state.js, FR-74). Remediation skips an app
// while it holds the lock and defers actions during the grace window after it.
//
// Act first, record second (FR-74): the patch and the wait come before any
// database write, and a failed write is logged and retried once.

const log = createLogger('rollout');

// FR-36: wait up to 3 minutes for every replica to run the new image
export const ROLLOUT_TIMEOUT_MS = 3 * 60 * 1000;
const RETRY_DELAY_MS = 1000;

/**
 * @param {{ id: string, slug: string, namespace: string }} app
 * @param {{ commitSha: string, commitMessage: string | null, imageRef: string }} image
 * @returns {Promise<{ status: 'ACTIVE' | 'FAILED' | 'SKIPPED', detail?: string, release?: object }>}
 */
export async function rollOut(app, image, { timeoutMs = ROLLOUT_TIMEOUT_MS } = {}) {
  if (isRolloutInProgress(app.slug)) return { status: 'SKIPPED', detail: 'a rollout is already running' };
  beginRollout(app.slug);
  const short = image.commitSha.slice(0, 7);
  try {
    log.info(`${app.slug}: rolling out ${short} from GHCR`);

    // 1. act
    let outcome;
    try {
      await setImage(app.namespace, app.slug, image.imageRef);
      outcome = await waitForRollout(app.namespace, app.slug, { timeoutMs });
    } catch (err) {
      outcome = { ready: false, detail: k8sErrorMessage(err) };
    }

    // 2. record
    if (!outcome.ready) {
      const detail = outcome.detail ?? `not ready within ${Math.round(timeoutMs / 60000)} minutes`;
      log.warn(`${app.slug}: rollout of ${short} failed (${detail}). The old pod keeps serving`);
      await retryOnce(`record failed release ${short}`, () =>
        prisma.release.create({ data: releaseData(app, image, 'FAILED') }),
      );
      return { status: 'FAILED', detail };
    }

    const release = await retryOnce(`record release ${short}`, () => recordActive(app, image));
    log.info(`${app.slug}: ${short} is live`);
    // With no release row (database down), the watcher sees this commit as new
    // on its next tick and runs the rollout again: the patch is a no-op, the
    // pods are already ready, and the release gets recorded then.
    if (!release) return { status: 'ACTIVE', detail: 'not recorded yet' };
    startGrace(release, app);
    await pruneImages(app.id);
    return { status: 'ACTIVE', release };
  } finally {
    endRollout(app.slug);
  }
}

const releaseData = (app, image, status) => ({
  appId: app.id,
  imageRef: image.imageRef,
  commitSha: image.commitSha,
  commitMessage: image.commitMessage,
  source: 'GHCR',
  status,
});

// the new release ACTIVE and the old one SUPERSEDED, in one transaction
async function recordActive(app, image) {
  const [, release] = await prisma.$transaction([
    prisma.release.updateMany({ where: { appId: app.id, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } }),
    prisma.release.create({ data: releaseData(app, image, 'ACTIVE') }),
  ]);
  return release;
}

// FR-74: retried once, then logged. Returns null if both tries failed
async function retryOnce(what, write) {
  try {
    return await write();
  } catch (first) {
    log.warn(`could not ${what}: ${errorMessage(first)}. Retrying once`);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    try {
      return await write();
    } catch (second) {
      log.error(`could not ${what} after a retry: ${errorMessage(second)}. The rollout already happened`);
      return null;
    }
  }
}
