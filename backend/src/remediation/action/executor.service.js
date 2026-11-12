import { env } from '../../config/env.config.js';
import { prisma } from '../../db/index.js';
import { deletePod, deploymentSpec, k8sErrorMessage, scaleDeployment, setImage } from '../../kubernetes/k8s.client.js';
import { storedImages } from '../../shipping/prune.service.js';
import { docker } from '../../utils/docker.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('remediation');

// Runs one action on the cluster and says how it went:
//   { result: 'APPLIED' | 'FAILED' | 'SKIPPED', dryRun, note,
//     action      the action that really ran (a rollback with no target restarts, FR-50)
//     expect      what verification checks afterwards (FR-73), see actionTookEffect()
//     rollback    { from, to } releases, for a rollback
//     attentionAfter  a reason to move to NEEDS_ATTENTION once it's verified }
// VERIFIED / UNVERIFIED come later, from verify.service.js.
//
// ctx: { appId, slug, namespace, pod } from the alert and the app, and
// toReleaseId for a manual rollback to a chosen release (FR-61)

export const MAX_REPLICAS = 3; // FR-46, PQ4

export async function executeAction(action, ctx) {
  const dryRun = env.remediationDryRun;
  const skipped = (note) => ({ result: 'SKIPPED', dryRun, note, action });

  if (action === 'NONE') return skipped('no action for this alert');
  if (!ctx.namespace) return skipped('alert has no namespace label');

  if (dryRun) {
    log.info(`[dry run] would ${action} ${ctx.slug} (pod ${ctx.pod ?? '?'})`);
    return skipped('dry run');
  }

  try {
    switch (action) {
      case 'RESTART':
        return await restartPod(ctx, dryRun);
      case 'ROLLBACK':
        return await rollBack(ctx, dryRun);
      case 'SCALE_UP':
        return await scaleUp(ctx, dryRun);
      case 'SCALE_DOWN':
        return await scaleTo(ctx, 1, dryRun, 'SCALE_DOWN');
      default:
        log.warn(`unknown action "${action}" for ${ctx.slug}`);
        return skipped('unknown action');
    }
  } catch (err) {
    log.warn(`${action} on ${ctx.slug} failed: ${k8sErrorMessage(err)}`);
    return { result: 'FAILED', dryRun, note: k8sErrorMessage(err), action };
  }
}

async function restartPod(ctx, dryRun, extra = {}) {
  if (!ctx.pod) return { result: 'SKIPPED', dryRun, note: 'alert has no pod label, nothing to restart', action: 'RESTART' };
  try {
    await deletePod(ctx.namespace, ctx.pod);
  } catch (err) {
    // the pod is often already gone (Kubernetes restarted it itself). Recorded
    // as FAILED so the record is honest
    log.warn(`could not delete ${ctx.namespace}/${ctx.pod}: ${k8sErrorMessage(err)}`);
    return { result: 'FAILED', dryRun, note: 'pod delete failed', action: 'RESTART' };
  }
  log.info(`restarted ${ctx.namespace}/${ctx.pod}`);
  return { result: 'APPLIED', dryRun, note: `deleted pod ${ctx.pod}`, action: 'RESTART', expect: { gone: ctx.pod }, ...extra };
}

/**
 * FR-50: the newest earlier release that is healthy (FR-72) and whose image is
 * still stored (FR-38), other than the one running now.
 */
export function pickRollbackTarget(releases, runningImage) {
  return rollbackCandidates(releases, runningImage)[0] ?? null;
}

// every possible target, best first
export function rollbackCandidates(releases, runningImage) {
  const stored = storedImages(releases);
  return [...releases]
    .sort((a, b) => new Date(b.deployedAt) - new Date(a.deployedAt))
    .filter((r) => r.healthyAt && r.imageRef !== runningImage && stored.has(r.imageRef));
}

// the image must really be on the laptop: deleting an app removes all its
// images, and a re-added app keeps its old releases (FR-65, FR-66)
const imageOnDisk = async (ref) => (await docker(['image', 'inspect', '--format', '{{.Id}}', ref])).code === 0;

async function rollBack(ctx, dryRun) {
  const { image: running } = await deploymentSpec(ctx.namespace, ctx.slug);
  const releases = await prisma.release.findMany({ where: { appId: ctx.appId } });
  if (ctx.toReleaseId) return rollBackTo(ctx, dryRun, releases, running);
  let target = null;
  for (const r of rollbackCandidates(releases, running)) {
    if (await imageOnDisk(r.imageRef)) {
      target = r;
      break;
    }
    log.info(`${ctx.slug}: ${r.commitSha.slice(0, 7)} is healthy but its image ${r.imageRef} isn't on disk any more`);
  }
  if (!target) {
    // FR-50: no healthy release to go back to: restart once, then NEEDS_ATTENTION
    log.warn(`${ctx.slug}: no earlier healthy release to roll back to; restarting once`);
    return restartPod(ctx, dryRun, { attentionAfter: 'no earlier healthy release to roll back to' });
  }
  return applyRollback(ctx, dryRun, releases, running, target);
}

// FR-61: the release a person picked. Same rules as the automatic pick: marked
// healthy, image still stored and on disk, not the one running now
async function rollBackTo(ctx, dryRun, releases, running) {
  const target = rollbackCandidates(releases, running).find((r) => r.id === ctx.toReleaseId);
  const no = (note) => ({ result: 'SKIPPED', dryRun, note, action: 'ROLLBACK' });
  if (!target) return no('that release is running now, was never marked healthy, or its image was pruned');
  if (!(await imageOnDisk(target.imageRef))) return no(`its image ${target.imageRef} isn't on the laptop any more`);
  return applyRollback(ctx, dryRun, releases, running, target);
}

async function applyRollback(ctx, dryRun, releases, running, target) {
  await setImage(ctx.namespace, ctx.slug, target.imageRef);
  const from = releases.find((r) => r.status === 'ACTIVE' && r.imageRef === running) ?? releases.find((r) => r.status === 'ACTIVE');
  log.info(`${ctx.slug}: rolled back to ${target.commitSha.slice(0, 7)} (${target.imageRef})`);
  return {
    result: 'APPLIED',
    dryRun,
    note: `rolled back to ${target.commitSha.slice(0, 7)}`,
    action: 'ROLLBACK',
    expect: { image: target.imageRef },
    rollback: { from: from ?? null, to: target },
  };
}

async function scaleUp(ctx, dryRun) {
  const { replicas } = await deploymentSpec(ctx.namespace, ctx.slug);
  if (replicas >= MAX_REPLICAS) {
    return { result: 'SKIPPED', dryRun, note: `already at ${MAX_REPLICAS} replicas, the cap`, action: 'SCALE_UP' };
  }
  return scaleTo(ctx, replicas + 1, dryRun, 'SCALE_UP', replicas);
}

async function scaleTo(ctx, replicas, dryRun, action, from = null) {
  const before = from ?? (await deploymentSpec(ctx.namespace, ctx.slug)).replicas;
  if (before === replicas) return { result: 'SKIPPED', dryRun, note: `already at ${replicas} replica(s)`, action };
  await scaleDeployment(ctx.namespace, ctx.slug, replicas);
  log.info(`${ctx.slug}: scaled ${before} -> ${replicas}`);
  return { result: 'APPLIED', dryRun, note: `replicas ${before} -> ${replicas}`, action, expect: { replicas }, replicas };
}
