import { prisma } from '../../db/index.js';
import { queryNumber } from '../../prometheus/prometheus.client.js';
import { inGrace } from '../../shipping/grace.service.js';
import { isRolloutInProgress } from '../../state/rollout.state.js';
import { appNamespace } from '../../utils/appNames.js';
import { errorMessage } from '../../utils/AppError.js';
import { createLogger } from '../../utils/logger.js';
import { heal } from '../healing/heal.service.js';
import * as state from '../healing/healing.state.js';

const log = createLogger('scaling');

// FR-47, every 60 s (src/index.js): an app above 1 replica whose pods have
// all stayed under 30% of their CPU request (100m) for 5 minutes goes back to 1.
// The attempt belongs to the app's latest scale-up incident (decision 6).

export const SCALE_DOWN_INTERVAL_MS = 60_000;
export const CPU_REQUEST_CORES = 0.1;
export const QUIET_SHARE = 0.3; // PQ4, proposed
export const QUIET_MINUTES = 5;

// The busiest pod's CPU in cores, at its peak over the last 5 minutes, sampled
// every 30 s. Fixed text, only the app's own names go in (FR-57).
export function busiestPodQuery(slug) {
  const ns = appNamespace(slug);
  return `max(max_over_time((max by (pod) (rate(container_cpu_usage_seconds_total{namespace="${ns}",container="${slug}"}[1m])))[${QUIET_MINUTES}m:30s]))`;
}

// how many 30 s samples the last 5 minutes hold: under 10 means too little data
export function coverageQuery(slug) {
  const ns = appNamespace(slug);
  return `count_over_time((sum(rate(container_cpu_usage_seconds_total{namespace="${ns}",container="${slug}"}[1m])))[${QUIET_MINUTES}m:30s])`;
}

export async function checkScaleDown(deps = { queryNumber, heal, db: prisma }) {
  const apps = await deps.db.app.findMany({
    where: { deletedAt: null, replicas: { gt: 1 } },
    select: { id: true, slug: true, namespace: true, replicas: true },
  });
  const results = [];
  for (const app of apps) {
    try {
      results.push({ slug: app.slug, ...(await checkApp(app, deps)) });
    } catch (err) {
      log.warn(`${app.slug}: scale-down check failed: ${errorMessage(err)}`);
      results.push({ slug: app.slug, state: 'error' });
    }
  }
  return results;
}

async function checkApp(app, deps) {
  if (isRolloutInProgress(app.slug) || inGrace(app.slug) || state.isVerifying(app.slug)) return { state: 'busy' };
  if (!state.isAutoHeal(app.slug) || state.getHealth(app.slug) === 'NEEDS_ATTENTION') return { state: 'not acting' };

  const samples = await deps.queryNumber(coverageQuery(app.slug));
  if ((samples ?? 0) < 2 * QUIET_MINUTES) return { state: 'not enough data' };
  const peak = await deps.queryNumber(busiestPodQuery(app.slug));
  if (peak === null || peak >= QUIET_SHARE * CPU_REQUEST_CORES) return { state: 'busy enough', peak };

  const incident = await deps.db.incident.findFirst({
    where: { appId: app.id, attempts: { some: { action: 'SCALE_UP' } } },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  if (!incident) {
    log.debug(`${app.slug}: at ${app.replicas} replicas with no scale-up incident; leaving it`);
    return { state: 'no scale-up incident' };
  }

  log.info(`${app.slug}: busiest pod peaked at ${Math.round(peak * 1000)}m CPU over ${QUIET_MINUTES} min, scaling back to 1`);
  const { attempt, followUp } = await deps.heal(app, 'SCALE_DOWN', {});
  // record second; the check already runs
  const saving = deps.db.remediationAttempt
    .create({ data: { incidentId: incident.id, ...attempt }, select: { id: true } })
    .then((r) => r.id)
    .catch((err) => {
      log.warn(`could not record ${app.slug}'s scale-down: ${errorMessage(err)}`);
      return null;
    });
  followUp(saving);
  await saving;
  return { state: attempt.result === 'APPLIED' ? 'scaled down' : attempt.result.toLowerCase(), peak };
}
