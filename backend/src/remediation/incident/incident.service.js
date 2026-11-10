import { env } from '../../config/env.config.js';
import { prisma } from '../../db/index.js';
import { recoverySeconds, toIncidentDto } from '../../models/dto.mapper.js';
import { isRolloutInProgress } from '../../state/rollout.state.js';
import { errorMessage } from '../../utils/AppError.js';
import { createLogger } from '../../utils/logger.js';
import { decideAction } from '../action/decision.service.js';
import { executeAction } from '../action/executor.service.js';
import * as memory from './incident.state.js';

const log = createLogger('incidents');

// FR-74: act first, record second. Decisions come from memory (incident.state.js),
// the action runs, and only then is the database written. A failed write is
// logged and retried once, and never delays or undoes the action.
export const RETRY_DELAY_MS = 1000;

// returns what happened, so the webhook can count skipped alerts:
// 'opened' | 'duplicate' | 'unknown-app' | 'resolved' | 'nothing-open'
export async function handleAlert(alert) {
  return alert.firing ? openIncident(alert) : resolveIncident(alert);
}

async function openIncident(alert) {
  // alertmanager re-sends firing alerts every repeat_interval.
  // same fingerprint + still open = same incident, don't act twice
  if (memory.isOpen(alert.fingerprint)) {
    log.debug(`${alert.alertName} for ${alert.appName} still firing`);
    return 'duplicate';
  }

  const app = await memory.findApp(alert.appName, alert.namespace);
  if (!app) {
    log.warn(`${alert.alertName} for unknown app "${alert.appName}", skipped`);
    return 'unknown-app';
  }

  const { action, cause } = decideAction(alert.alertName, alert.summary);
  const target = { ...alert, namespace: alert.namespace ?? app.namespace };

  // claim the fingerprint before acting, so a repeat arriving meanwhile is a duplicate
  const record = {
    slug: app.slug,
    appId: app.id,
    fingerprint: alert.fingerprint,
    alertName: alert.alertName,
    cause,
    startedAt: alert.startsAt,
    attempt: null,
  };
  memory.markOpen(alert.fingerprint, record);

  // 1. act
  const attemptedAt = new Date();
  const outcome = isRolloutInProgress(app.slug)
    ? { result: 'SKIPPED', dryRun: env.remediationDryRun, note: 'app is mid-rollout' }
    : await executeAction(action, target);
  record.attempt = { action, trigger: 'AUTO', dryRun: outcome.dryRun, result: outcome.result, attemptedAt };
  log.info(`${alert.alertName} on ${app.slug} -> ${action} ${outcome.result} (${outcome.note})`);

  // 2. record
  const saved = await withRetry(`record ${alert.alertName} on ${app.slug}`, () => createIncident(record));
  if (saved) memory.markRecorded(alert.fingerprint, saved.id);
  return 'opened';
}

async function resolveIncident(alert) {
  const entry = memory.close(alert.fingerprint);
  const resolvedAt = alert.endsAt ?? new Date();

  const done = await withRetry(`resolve ${alert.alertName} on ${alert.appName}`, async () => {
    // the incident never reached the database: save it now, already resolved
    if (entry?.pending) {
      await createIncident(entry.pending, resolvedAt);
      return 1;
    }
    const openRows = await prisma.incident.findMany({
      where: { fingerprint: alert.fingerprint, status: 'OPEN' },
      select: { id: true, startedAt: true },
    });
    for (const row of openRows) {
      await prisma.incident.update({
        where: { id: row.id },
        data: { status: 'RESOLVED', resolvedAt, recoverySeconds: recoverySeconds(row.startedAt, resolvedAt) },
      });
    }
    return openRows.length;
  });

  if (!entry && !done) return 'nothing-open';
  log.info(`${alert.alertName} on ${alert.appName} resolved`);
  return 'resolved';
}

// One incident with its attempt, in one write. resolvedAt given = save it resolved.
async function createIncident(record, resolvedAt = null) {
  // the app may have been looked up while the database was down
  const appId =
    record.appId ??
    (await prisma.app.findFirst({ where: { slug: record.slug, deletedAt: null }, select: { id: true } }))?.id;
  if (!appId) throw new Error(`no app ${record.slug} in the database`);

  return prisma.incident.create({
    data: {
      appId,
      fingerprint: record.fingerprint,
      alertName: record.alertName,
      cause: record.cause,
      startedAt: record.startedAt,
      ...(resolvedAt && {
        status: 'RESOLVED',
        resolvedAt,
        recoverySeconds: recoverySeconds(record.startedAt, resolvedAt),
      }),
      attempts: record.attempt ? { create: [record.attempt] } : undefined,
    },
    select: { id: true },
  });
}

// Runs a database write, retrying once after a short wait (FR-74). Returns the
// result, or null if both tries failed; the failure is logged, never thrown.
export async function withRetry(what, write, delayMs = RETRY_DELAY_MS) {
  try {
    return await write();
  } catch (first) {
    log.warn(`could not ${what}: ${errorMessage(first).split('\n')[0]}. Retrying once`);
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      return await write();
    } catch (second) {
      log.error(`could not ${what} after a retry: ${errorMessage(second).split('\n')[0]}. The action already ran`);
      return null;
    }
  }
}

export async function listIncidents(limit = 50) {
  const rows = await prisma.incident.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: { app: true, attempts: true },
  });
  return rows.map(toIncidentDto);
}

// at boot (src/index.js)
export const rebuildIncidentState = memory.rebuild;
