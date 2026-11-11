import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.config.js';
import { prisma } from '../../db/index.js';
import { recoverySeconds } from '../../models/dto.mapper.js';
import { inGrace } from '../../shipping/grace.service.js';
import { storedImages } from '../../shipping/prune.service.js';
import { isRolloutInProgress } from '../../state/rollout.state.js';
import { MANUAL_ROLLBACK } from '../../types/incident.types.js';
import { AppError, NotFoundError } from '../../utils/AppError.js';
import { createLogger } from '../../utils/logger.js';
import { reportIncident } from '../issue/issue.service.js';
import { WRITE_FAILED, withRetry } from '../incident/incident.service.js';
import { heal } from './heal.service.js';
import * as state from './healing.state.js';

const log = createLogger('remediation');

// FR-60, FR-61: "Roll back to this" on the release list. The same path as an
// automatic rollback (heal() with trigger MANUAL): act first, then the grace
// window, HEALING and the 90 s check. Allowed with auto-heal off and while the
// app NEEDS_ATTENTION (a person decided, decision 4); refused during a rollout,
// a grace window or another action's check.
//
// Every manual rollback gets its own incident (decision 3), resolved when its
// check ends, so it shows on the dashboard and in the GitHub issue (FR-55)
// like any other.

/**
 * Why `release` can't be rolled back to now, or null when it can.
 * @param {{ slug: string, releases: object[] }} app with all its releases
 */
export function rollbackBlocked(app, release, { now = Date.now() } = {}) {
  if (!app.releases.some((r) => r.status === 'ACTIVE')) return 'the app has nothing running';
  if (release.status === 'ACTIVE') return 'this release is the one running now';
  if (release.source === 'TEST' || !release.healthyAt) return 'only releases that were marked healthy can be rolled back to (FR-61)';
  if (!storedImages(app.releases).has(release.imageRef)) return 'its image was pruned (Kairo keeps the last 3)';
  if (env.remediationDryRun) return 'REMEDIATION_DRY_RUN is on, so Kairo changes nothing in the cluster';
  if (isRolloutInProgress(app.slug)) return 'a rollout is in progress';
  if (inGrace(app.slug, now)) return 'the current release is still in its 60 s grace window';
  if (state.isVerifying(app.slug)) return 'Kairo is still checking another action on this app';
  return null;
}

/**
 * POST /api/apps/:slug/rollback { releaseId }
 * @param {{ login: string }} user who clicked it
 * @returns {Promise<{ incidentId: string|null, attempt: object, note: string }>}
 */
export async function manualRollback(slug, releaseId, user) {
  if (typeof releaseId !== 'string' || !releaseId) throw new AppError('releaseId is required', 400);
  const app = await prisma.app.findFirst({ where: { slug, deletedAt: null }, include: { releases: true } });
  if (!app) throw new NotFoundError('App');
  const target = app.releases.find((r) => r.id === releaseId);
  if (!target) throw new NotFoundError('Release');
  const blocked = rollbackBlocked(app, target);
  if (blocked) throw new AppError(`Can't roll back to ${target.commitSha.slice(0, 7)}: ${blocked}`, 409);

  // 1. act
  const startedAt = new Date();
  const { attempt, note, followUp } = await heal(app, 'ROLLBACK', { pod: null, toReleaseId: target.id }, 'MANUAL');
  log.info(`${slug}: manual rollback to ${target.commitSha.slice(0, 7)} by ${user?.login ?? 'someone'} -> ${attempt.result} (${note})`);
  if (attempt.result === 'SKIPPED') throw new AppError(`Kairo didn't roll back: ${note}`, 409);

  // 2. record: its own incident, with the attempt
  const saving = withRetry(`record ${slug}'s manual rollback`, () =>
    prisma.incident.create({
      data: {
        appId: app.id,
        fingerprint: `manual:${randomUUID()}`,
        alertName: MANUAL_ROLLBACK,
        cause: `Rolled back by ${user?.login ?? 'someone'} from the release list`,
        startedAt,
        attempts: { create: [attempt] },
      },
      select: { id: true, attempts: { select: { id: true } } },
    }),
  );
  const checked = followUp(saving.then((saved) => (saved === WRITE_FAILED ? null : saved.attempts[0]?.id ?? null)));
  const saved = await saving;
  if (saved !== WRITE_FAILED) {
    reportIncident(saved.id).catch(() => {}); // FR-55
    // 3. resolve once the check ends, verified or not: nothing else will
    checked.then(() => resolveManual(saved.id, startedAt)).catch(() => {});
  }
  return { incidentId: saved === WRITE_FAILED ? null : saved.id, attempt, note };
}

async function resolveManual(id, startedAt) {
  const resolvedAt = new Date();
  await withRetry('resolve a manual rollback', () =>
    prisma.incident.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt, recoverySeconds: recoverySeconds(startedAt, resolvedAt) },
    }),
  );
}

// At boot: a manual rollback left open by a restart has no alert to resolve
// it. Its attempt's check resumes on its own (resumeVerifications)
export async function closeLeftoverManual(now = new Date()) {
  const open = await prisma.incident.findMany({ where: { alertName: MANUAL_ROLLBACK, status: 'OPEN' }, select: { id: true, startedAt: true } });
  for (const i of open) {
    await prisma.incident.update({
      where: { id: i.id },
      data: { status: 'RESOLVED', resolvedAt: now, recoverySeconds: recoverySeconds(i.startedAt, now) },
    });
  }
  return open.length;
}
