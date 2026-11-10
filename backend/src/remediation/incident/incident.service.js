import { prisma } from '../../db/index.js';
import { recoverySeconds, toIncidentDto } from '../../models/dto.mapper.js';
import { createLogger } from '../../utils/logger.js';
import { decideAction } from '../action/decision.service.js';
import { executeAction } from '../action/executor.service.js';

const log = createLogger('incidents');

// returns what happened, so the webhook can count skipped alerts:
// 'opened' | 'duplicate' | 'unknown-app' | 'resolved' | 'nothing-open'
export async function handleAlert(alert) {
  return alert.firing ? openIncident(alert) : resolveIncident(alert);
}

async function openIncident(alert) {
  // alertmanager re-sends firing alerts every repeat_interval.
  // same fingerprint + still open = same incident, don't create another one
  const existing = await prisma.incident.findFirst({
    where: { fingerprint: alert.fingerprint, status: 'OPEN' },
  });
  if (existing) {
    log.debug(`${alert.alertName} for ${alert.appName} still firing (${existing.id})`);
    return 'duplicate';
  }

  // the alert's app label is the app's slug. no app = not ours, skip it
  const app = await prisma.app.findFirst({
    where: { slug: alert.appName, deletedAt: null },
    select: { id: true },
  });
  if (!app) {
    log.warn(`${alert.alertName} for unknown app "${alert.appName}", skipped`);
    return 'unknown-app';
  }

  const { action, cause } = decideAction(alert.alertName, alert.summary);

  // TODO(P1, FR-74): act first, record second, so a database outage can't block healing
  const incident = await prisma.incident.create({
    data: {
      appId: app.id,
      fingerprint: alert.fingerprint,
      alertName: alert.alertName,
      cause,
      startedAt: alert.startsAt,
    },
  });
  log.info(`incident ${incident.id}: ${alert.alertName} on ${alert.appName} -> ${action}`);

  const outcome = await executeAction(action, alert);
  await prisma.remediationAttempt.create({
    data: {
      incidentId: incident.id,
      action,
      trigger: 'AUTO',
      dryRun: outcome.dryRun,
      result: outcome.result,
    },
  });
  log.debug(`attempt for ${incident.id}: ${action} ${outcome.result} (${outcome.note})`);
  return 'opened';
}

async function resolveIncident(alert) {
  const open = await prisma.incident.findMany({
    where: { fingerprint: alert.fingerprint, status: 'OPEN' },
    select: { id: true, startedAt: true },
  });
  if (open.length === 0) return 'nothing-open';

  const resolvedAt = alert.endsAt ?? new Date();
  for (const incident of open) {
    await prisma.incident.update({
      where: { id: incident.id },
      data: {
        status: 'RESOLVED',
        resolvedAt,
        recoverySeconds: recoverySeconds(incident.startedAt, resolvedAt),
      },
    });
  }
  log.info(`${alert.alertName} on ${alert.appName} resolved`);
  return 'resolved';
}

export async function listIncidents(limit = 50) {
  const rows = await prisma.incident.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: { app: true, attempts: true },
  });
  return rows.map(toIncidentDto);
}
