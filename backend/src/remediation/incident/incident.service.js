import { toIncidentDto } from '../../models/dto.mapper.js';
import { prisma } from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import { decideAction } from '../action/decision.service.js';
import { executeAction } from '../action/executor.service.js';

const log = createLogger('incidents');

export async function handleAlert(alert) {
  if (alert.firing) await openIncident(alert);
  else await resolveIncident(alert);
}

async function openIncident(alert) {
  // alertmanager re-sends firing alerts every repeat_interval.
  // same fingerprint + still open = same incident, don't create another one
  const existing = await prisma.incident.findFirst({
    where: { fingerprint: alert.fingerprint, status: 'OPEN' },
  });
  if (existing) {
    log.debug(`${alert.alertName} for ${alert.appName} still firing (${existing.id})`);
    return;
  }

  const { action, cause } = decideAction(alert.alertName, alert.summary);

  const deployment = await prisma.deployment.findFirst({
    where: { appName: alert.appName },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  const incident = await prisma.incident.create({
    data: {
      fingerprint: alert.fingerprint,
      alertName: alert.alertName,
      appName: alert.appName,
      deploymentId: deployment?.id ?? null,
      cause,
      action,
      startedAt: alert.startsAt,
    },
  });
  log.info(`incident ${incident.id}: ${alert.alertName} on ${alert.appName} -> ${action}`);

  const result = await executeAction(action, alert);
  log.debug(`action result for ${incident.id}`, result);
}

async function resolveIncident(alert) {
  const { count } = await prisma.incident.updateMany({
    where: { fingerprint: alert.fingerprint, status: 'OPEN' },
    data: { status: 'RESOLVED', resolvedAt: alert.endsAt ?? new Date() },
  });

  if (count > 0) log.info(`${alert.alertName} on ${alert.appName} resolved`);
}

export async function listIncidents(limit = 50) {
  const rows = await prisma.incident.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
  return rows.map(toIncidentDto);
}
