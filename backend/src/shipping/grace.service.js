import { prisma } from '../db/index.js';
import { k8sErrorMessage, releaseReady } from '../kubernetes/k8s.client.js';
import { createLogger } from '../utils/logger.js';

// The grace window after every rollout (FR-71, FR-72), borrowed from Kairo
// Shield's R4. For GRACE_MS after a release goes live, Kairo watches it; at the
// end, the release is marked healthy (healthyAt) only if every desired replica
// runs it and is ready, and no Kairo alert is open for the app. Only healthy
// releases are rollback targets, and only a healthy preview gets a PR (FR-30).
//
// Every rollout starts one: the preview (generator/pipeline.service.js) and
// GHCR rollouts (rollout.service.js); P3's rollbacks will too. During the
// window remediation records alerts for the app but defers their actions
// (FR-37, FR-71); when it ends, onEnd runs the ones still firing.
//
// Windows live in memory (FR-74) and are rebuilt from the releases at boot.

const log = createLogger('grace');

// FR-71, proposed 60 s (PQ10: checked against the reference repos in P2c)
export const GRACE_MS = 60_000;

const windows = new Map(); // slug -> { releaseId, endsAt, timer }

// Wired in src/index.js, so shipping/ doesn't import remediation/ or generator/:
//   isAlerting(slug) -> boolean          remediation's open incidents
//   onHealthy(release, app)              e.g. open the setup PR
//   onUnhealthy(release, app, reason)
//   onEnd(slug)                          run the alert actions deferred during the window
// and releaseReady, the Kubernetes check, replaceable so a unit test needs no cluster
const hooks = {
  isAlerting: () => false,
  onHealthy: async () => {},
  onUnhealthy: async () => {},
  onEnd: async () => {},
  releaseReady,
};
export function configureGrace(h) {
  Object.assign(hooks, h);
}

/** @param {{ id: string, imageRef: string, deployedAt: Date }} release  @param {{ id: string, slug: string, namespace: string }} app */
export function startGrace(release, app, now = Date.now()) {
  stopGrace(app.slug);
  const endsAt = new Date(release.deployedAt).getTime() + GRACE_MS;
  const timer = setTimeout(() => {
    endGrace(release.id).catch((err) => log.error(`grace window for ${app.slug} failed`, err));
  }, Math.max(0, endsAt - now));
  timer.unref?.();
  windows.set(app.slug, { releaseId: release.id, endsAt, timer });
  log.info(
    endsAt > now
      ? `${app.slug}: grace window until ${new Date(endsAt).toISOString().slice(11, 19)} UTC`
      : `${app.slug}: grace window already over, checking the release now`,
  );
}

export function stopGrace(slug) {
  const w = windows.get(slug);
  if (w) clearTimeout(w.timer);
  windows.delete(slug);
}

// FR-37, FR-71: remediation asks this (P2c)
export const inGrace = (slug, now = Date.now()) => (windows.get(slug)?.endsAt ?? 0) > now;

/**
 * The FR-72 check, at the end of the window or when asked again (Try again).
 * @returns {Promise<{ healthy: boolean, reason?: string }>}
 */
export async function endGrace(releaseId) {
  const release = await prisma.release.findUnique({ where: { id: releaseId }, include: { app: true } });
  if (!release) return { healthy: false, reason: 'the release is gone' };
  const { app } = release;
  if (windows.get(app.slug)?.releaseId === releaseId) windows.delete(app.slug);

  // the verdict first: an alert still firing now keeps the release from being
  // marked healthy (FR-72); then its deferred action runs (FR-71)
  const verdict = await judge(release, app);
  if (!inGrace(app.slug)) {
    await hooks.onEnd(app.slug).catch((err) => log.error(`deferred actions for ${app.slug} failed`, err));
  }
  return verdict;
}

async function judge(release, app) {
  if (release.healthyAt) {
    await hooks.onHealthy(release, app);
    return { healthy: true };
  }
  const verdict = await checkHealthy(release, app);
  if (verdict.healthy) {
    // a newer release may have replaced it meanwhile: only an ACTIVE one counts
    const marked = await prisma.release.updateMany({
      where: { id: release.id, status: 'ACTIVE', healthyAt: null },
      data: { healthyAt: new Date() },
    });
    if (marked.count) {
      log.info(`${app.slug}: release ${release.commitSha.slice(0, 7)} is healthy`);
      await hooks.onHealthy({ ...release, healthyAt: new Date() }, app);
      return { healthy: true };
    }
    verdict.healthy = false;
    verdict.reason = 'a newer release replaced it';
  }
  log.warn(`${app.slug}: release ${release.commitSha.slice(0, 7)} not marked healthy: ${verdict.reason}`);
  await hooks.onUnhealthy(release, app, verdict.reason);
  return verdict;
}

async function checkHealthy(release, app) {
  if (release.status !== 'ACTIVE') return { healthy: false, reason: `the release is ${release.status}` };
  if (hooks.isAlerting(app.slug)) return { healthy: false, reason: 'a Kairo alert is firing for the app' };
  try {
    const ready = await hooks.releaseReady(app.namespace, app.slug, release.imageRef);
    return ready.ready ? { healthy: true } : { healthy: false, reason: ready.detail };
  } catch (err) {
    return { healthy: false, reason: `couldn't read the Deployment (${k8sErrorMessage(err)})` };
  }
}

// At boot: every ACTIVE release that isn't healthy yet gets its window back,
// or its check now if the window already passed (PRD section 8: the backend
// restarting during a grace window).
export async function rebuildGrace(now = Date.now()) {
  const pending = await prisma.release.findMany({
    where: { status: 'ACTIVE', healthyAt: null, app: { deletedAt: null } },
    include: { app: true },
  });
  for (const r of pending) startGrace(r, r.app, now);
  return pending.length;
}

// for tests
export function _resetGrace() {
  for (const w of windows.values()) clearTimeout(w.timer);
  windows.clear();
}
