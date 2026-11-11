import { prisma } from '../db/index.js';
import { deleteAlertRules, deleteNamespace, k8sErrorMessage, podCount } from '../kubernetes/k8s.client.js';
import * as healing from '../remediation/healing/healing.state.js';
import { forgetAppIncidents } from '../remediation/incident/incident.service.js';
import { stopGrace } from '../shipping/grace.service.js';
import { isRolloutInProgress } from '../state/rollout.state.js';
import { stopTraffic } from '../testpanel/traffic.service.js';
import { AppError, errorMessage, NotFoundError } from '../utils/AppError.js';
import { docker } from '../utils/docker.js';
import { createLogger } from '../utils/logger.js';

// DELETE /api/apps/:slug (FR-65, FR-66, Stitch 09). In order:
//
//   1. checks: the typed name matches; no build, rollout or checked action
//      is running for the app (each would keep changing it)
//   2. stop: grace window and Send Traffic
//   3. cluster: delete the namespace (Deployment, Service, Ingress, pods all
//      go with it) and the app's key in the alert rules ConfigMap; then
//      healing and incident memory forget the app
//   4. record: open incidents closed, deletedAt set. Releases, incidents and
//      attempts stay, so the history is kept
//   5. after the answer: once the namespace has no pods left, remove the
//      app's images from the laptop (an image a container still uses can't be).
//      FR-68 lets kairo-platform list pods but not read namespaces
//
// GitHub is never touched: repo, PR, workflow, GHCR images and issues stay
// (FR-66). The GHCR watcher and the scale-down check only look at apps
// without deletedAt, so they stop by themselves. Kairo has no tunnel yet
// (Cloudflare quick tunnels come later); publicUrl is cleared all the same.

const log = createLogger('delete');

export const NAMESPACE_GONE_WITHIN_MS = 120_000;
const POLL_MS = 2000;

// Break It's image is shared by every app
const SHARED_IMAGES = new Set(['kairo/broken-release:1']);

export async function deleteApp(slug, confirm, deps = { deleteNamespace, deleteAlertRules, cleanUpLater }) {
  const app = await prisma.app.findFirst({
    where: { slug, deletedAt: null },
    include: { releases: { select: { imageRef: true } } },
  });
  if (!app) throw new NotFoundError('App');
  if (confirm !== app.slug) throw new AppError(`Type the app's name (${app.slug}) to confirm`, 400);

  const running = await prisma.pipelineRun.findFirst({ where: { appId: app.id, finishedAt: null }, select: { id: true } });
  if (running) throw new AppError('A pipeline run is still going for this app; delete it once the run ends', 409);
  if (isRolloutInProgress(slug)) throw new AppError('The app is being rolled out; try again in a moment', 409);
  if (healing.isVerifying(slug)) throw new AppError('Kairo is checking an action on this app (up to 90 s); try again in a moment', 409);

  // 2. stop what would change the app while it goes
  stopGrace(slug);
  stopTraffic(slug);

  // 3. the cluster
  let namespace;
  try {
    namespace = await deps.deleteNamespace(app.namespace);
    await deps.deleteAlertRules(slug);
  } catch (err) {
    // nothing is marked deleted: Delete can be tried again
    throw new AppError(`Could not remove the app from the cluster: ${k8sErrorMessage(err)}`, 502);
  }
  log.info(`${slug}: namespace ${app.namespace} ${namespace === 'gone' ? 'was already gone' : 'deleting'}, alert rules removed`);
  // healing forgets it only now: if the cluster step failed, the app still runs
  healing.forget(slug);
  forgetAppIncidents(slug);

  // 4. record; history stays
  const now = new Date();
  const [closed] = await prisma.$transaction([
    prisma.incident.updateMany({ where: { appId: app.id, status: 'OPEN' }, data: { status: 'RESOLVED', resolvedAt: now } }),
    prisma.app.update({ where: { id: app.id }, data: { deletedAt: now, publicUrl: null, health: 'HEALTHY', replicas: 1 } }),
  ]);
  if (closed.count) log.info(`${slug}: closed ${closed.count} open incident(s), no recovery time`);

  // 5. images, in the background
  const images = [...new Set(app.releases.map((r) => r.imageRef))].filter((ref) => !SHARED_IMAGES.has(ref));
  deps.cleanUpLater(app, images);

  return {
    slug,
    namespace: app.namespace,
    namespaceState: namespace,
    closedIncidents: closed.count,
    imagesToRemove: images.length,
    deletedAt: now.toISOString(),
  };
}

// waits for the namespace to go, then removes the images. Never throws
export function cleanUpLater(app, images) {
  removeImagesWhenGone(app, images).catch((err) => log.warn(`${app.slug}: cleaning up images failed: ${errorMessage(err)}`));
}

async function removeImagesWhenGone(app, images, waitMs = NAMESPACE_GONE_WITHIN_MS) {
  const until = Date.now() + waitMs;
  while ((await podCount(app.namespace)) > 0) {
    if (Date.now() > until) {
      log.warn(`${app.slug}: pods still running in ${app.namespace} after ${waitMs / 1000} s; its images stay for now`);
      return { removed: [] };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  log.info(`${app.slug}: no pods left in ${app.namespace}; removing its images`);
  const removed = [];
  for (const ref of images) {
    const { code, output } = await docker(['image', 'rm', ref]);
    if (code === 0) removed.push(ref);
    else if (!/No such image/i.test(output)) log.warn(`${app.slug}: kept ${ref}: ${output.split('\n')[0]}`);
  }
  log.info(`${app.slug}: removed ${removed.length} of ${images.length} image(s)`);
  return { removed };
}
