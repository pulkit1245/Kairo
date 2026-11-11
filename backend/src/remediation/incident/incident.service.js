import { env } from '../../config/env.config.js';
import { prisma } from '../../db/index.js';
import { recoverySeconds, toIncidentDto } from '../../models/dto.mapper.js';
import { inGrace, noteAlert } from '../../shipping/grace.service.js';
import { isRolloutInProgress } from '../../state/rollout.state.js';
import { shortError } from '../../utils/AppError.js';
import { createLogger } from '../../utils/logger.js';
import { decideAction } from '../action/decision.service.js';
import { heal } from '../healing/heal.service.js';
import * as memory from './incident.state.js';

const log = createLogger('incidents');

// FR-74: act first, record second. Decisions come from memory (incident.state.js),
// the action runs, and only then is the database written. A failed write is
// logged and retried once, and never delays or undoes the action. If the retry
// fails too, the write waits in memory and flushUnsaved() tries it again every
// FLUSH_INTERVAL_MS until the database is back, so an outage loses nothing
// unless the backend itself dies during it.
export const RETRY_DELAY_MS = 1000;
export const FLUSH_INTERVAL_MS = 15_000;
const FAILED = Symbol('write failed');

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
    const entry = memory.getOpen(alert.fingerprint);
    if (entry.deferred) {
      // the newest pod name, for a restart after the window
      if (alert.pod) entry.deferred.target = { ...entry.deferred.target, pod: alert.pod };
      // the window ended without running it (e.g. the backend restarted): now
      if (!inGrace(entry.slug)) await runDeferred(alert.fingerprint);
    }
    return 'duplicate';
  }

  const app = await memory.findApp(alert.appName, alert.namespace);
  if (!app) {
    log.warn(`${alert.alertName} for unknown app "${alert.appName}", skipped`);
    return 'unknown-app';
  }

  const { action, cause } = decideAction(alert.alertName, alert.summary);
  // what an action needs: the app and the pod the alert named
  const target = { alertName: alert.alertName, pod: alert.pod ?? null };

  // FR-72: an OOM kill or crash loop inside a grace window rules the release out
  if (noteAlert(app.slug, alert.alertName)) log.info(`${alert.alertName} on ${app.slug} in its grace window: the release won't be marked healthy`);

  // FR-71: during the grace window after a rollout, record the alert and
  // defer its action; runDeferredActions() runs it if it still fires at the end
  const defer = !isRolloutInProgress(app.slug) && inGrace(app.slug);

  // claim the fingerprint before acting, so a repeat arriving meanwhile is a duplicate
  const record = {
    slug: app.slug,
    appId: app.id,
    fingerprint: alert.fingerprint,
    alertName: alert.alertName,
    pod: alert.pod,
    cause,
    startedAt: alert.startsAt,
    attempt: null,
  };
  memory.markOpen(alert.fingerprint, record, defer ? { action, target } : null);

  if (defer) {
    log.info(`${alert.alertName} on ${app.slug} in its grace window: recorded, ${action} deferred until the window ends`);
    const saved = await withRetry(`record ${alert.alertName} on ${app.slug}`, () => createIncident(record));
    if (saved !== FAILED) memory.markRecorded(alert.fingerprint, saved.id);
    return 'opened';
  }

  // 1. act (heal.service.js decides whether it may)
  const { attempt, note, followUp } = await heal(app, action, target);
  record.attempt = attempt;
  log.info(`${alert.alertName} on ${app.slug} -> ${attempt.action} ${attempt.result} (${note})`);

  // 2. record. The verification already runs; it gets the attempt's id once saved
  const saving = withRetry(`record ${alert.alertName} on ${app.slug}`, () => createIncident(record));
  followUp(saving.then((saved) => (saved === FAILED ? null : saved.attempts[0]?.id ?? null)));
  const saved = await saving;
  if (saved !== FAILED) memory.markRecorded(alert.fingerprint, saved.id);
  // else: the record stays in memory as pending, for the resolve or the flush
  return 'opened';
}

// FR-71, at the end of an app's grace window (wired in src/index.js): every
// alert that fired during it and is still open gets its normal action now.
// One that resolved during the window gets a SKIPPED attempt saying so
// (resolveIncident), and nothing is done in the cluster.
export async function runDeferredActions(slug) {
  const fingerprints = memory.deferredFor(slug);
  for (const fingerprint of fingerprints) await runDeferred(fingerprint);
  return fingerprints.length;
}

async function runDeferred(fingerprint) {
  const entry = memory.getOpen(fingerprint);
  // a new rollout started meanwhile: it waits for that one's window instead
  if (!entry?.deferred || isRolloutInProgress(entry.slug)) return;
  const { action, target } = memory.takeDeferred(fingerprint);
  const app = await memory.findApp(entry.slug, null);
  if (!app) return;

  // 1. act
  const { attempt, note, followUp } = await heal(app, action, target);
  log.info(`${target.alertName} on ${entry.slug} still firing after the grace window -> ${attempt.action} ${attempt.result} (${note})`);

  // 2. record
  if (entry.pending) {
    entry.pending.attempt = attempt; // saved with the incident, by the resolve or the flush
    followUp(null);
    return;
  }
  const saving = withRetry(`record the deferred ${action} on ${entry.slug}`, () =>
    prisma.remediationAttempt.create({ data: { incidentId: entry.incidentId, ...attempt }, select: { id: true } }),
  );
  followUp(saving.then((saved) => (saved === FAILED ? null : saved.id)));
  if ((await saving) === FAILED) memory.queueWrite({ kind: 'attempt', incidentId: entry.incidentId, attempt });
}

// the SKIPPED attempt of an alert that resolved while its action waited for
// the grace window to end: what Kairo would have done, and why it didn't
export const RESOLVED_IN_GRACE = 'the alert resolved during the grace window, before its deferred action ran';

async function resolveIncident(alert) {
  const entry = memory.close(alert.fingerprint);
  const resolvedAt = alert.endsAt ?? new Date();
  const skipped = entry?.deferred
    ? {
        action: entry.deferred.action,
        trigger: 'AUTO',
        dryRun: env.remediationDryRun,
        result: 'SKIPPED',
        attemptedAt: resolvedAt,
        reason: RESOLVED_IN_GRACE,
      }
    : null;
  if (skipped && entry.pending) entry.pending.attempt = skipped;

  const done = await withRetry(`resolve ${alert.alertName} on ${alert.appName}`, async () => {
    // the incident never reached the database: save it now, already resolved
    if (entry?.pending) {
      await createIncident(entry.pending, resolvedAt);
      return 1;
    }
    return resolveRows(alert.fingerprint, resolvedAt);
  });

  if (done === FAILED) {
    memory.queueWrite(
      entry?.pending
        ? { kind: 'save', record: entry.pending, resolvedAt }
        : { kind: 'resolve', fingerprint: alert.fingerprint, resolvedAt },
    );
    log.warn(`${alert.alertName} on ${alert.appName} resolved, not saved yet: queued until the database is back`);
    return 'resolved';
  }
  if (!entry && !done) return 'nothing-open';
  // a recorded incident gets the skipped attempt as its own row
  if (skipped && !entry.pending) {
    const saved = await withRetry(`record the skipped action on ${alert.appName}`, () =>
      prisma.remediationAttempt.create({ data: { incidentId: entry.incidentId, ...skipped }, select: { id: true } }),
    );
    if (saved === FAILED) memory.queueWrite({ kind: 'attempt', incidentId: entry.incidentId, attempt: skipped });
  }
  log.info(`${alert.alertName} on ${alert.appName} resolved${skipped ? ` (its deferred ${skipped.action} never ran)` : ''}`);
  return 'resolved';
}

async function resolveRows(fingerprint, resolvedAt) {
  const openRows = await prisma.incident.findMany({
    where: { fingerprint, status: 'OPEN' },
    select: { id: true, startedAt: true },
  });
  for (const row of openRows) {
    await prisma.incident.update({
      where: { id: row.id },
      data: { status: 'RESOLVED', resolvedAt, recoverySeconds: recoverySeconds(row.startedAt, resolvedAt) },
    });
  }
  return openRows.length;
}

// Retries every write still waiting in memory, once each. Called on a timer
// (src/index.js). Returns how many were saved; failures stay queued.
let flushing = false;
export async function flushUnsaved() {
  if (flushing || memory.unsavedCount() === 0) return 0;
  flushing = true;
  let saved = 0;
  try {
    for (const { fingerprint, record } of memory.unsavedOpen()) {
      try {
        const row = await createIncident(record);
        memory.markRecorded(fingerprint, row.id);
        saved++;
      } catch {
        // database still down: try again next time
      }
    }
    for (const item of memory.takeOutbox()) {
      try {
        if (item.kind === 'save') await createIncident(item.record, item.resolvedAt);
        else if (item.kind === 'attempt') {
          await prisma.remediationAttempt.create({ data: { incidentId: item.incidentId, ...item.attempt } });
        } else await resolveRows(item.fingerprint, item.resolvedAt);
        saved++;
      } catch {
        memory.queueWrite(item);
      }
    }
  } finally {
    flushing = false;
  }
  if (saved) log.info(`saved ${saved} incident write(s) that were waiting for the database`);
  return saved;
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
      pod: record.pod ?? null,
      cause: record.cause,
      startedAt: record.startedAt,
      ...(resolvedAt && {
        status: 'RESOLVED',
        resolvedAt,
        recoverySeconds: recoverySeconds(record.startedAt, resolvedAt),
      }),
      attempts: record.attempt ? { create: [record.attempt] } : undefined,
    },
    select: { id: true, attempts: { select: { id: true } } },
  });
}

// Runs a database write, retrying once after a short wait (FR-74). Returns the
// result, or FAILED if both tries failed; the failure is logged, never thrown.
export async function withRetry(what, write, delayMs = RETRY_DELAY_MS) {
  try {
    return await write();
  } catch (first) {
    log.warn(`could not ${what}: ${shortError(first)}. Retrying once`);
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      return await write();
    } catch (second) {
      log.error(`could not ${what} after a retry: ${shortError(second)}. The action already ran`);
      return FAILED;
    }
  }
}

export const WRITE_FAILED = FAILED;

// what an incident DTO needs: the app, and each attempt's releases
const WITH_ATTEMPTS = {
  app: true,
  attempts: {
    include: {
      fromRelease: { select: { commitSha: true, source: true } },
      toRelease: { select: { commitSha: true, source: true } },
    },
  },
};

export async function listIncidents(limit = 50, where = {}) {
  const rows = await prisma.incident.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: WITH_ATTEMPTS,
  });
  return rows.map(toIncidentDto);
}

// one incident row with its app and attempts, or null
export function findIncident(id) {
  return prisma.incident.findUnique({ where: { id }, include: WITH_ATTEMPTS });
}

// at boot (src/index.js)
export const rebuildIncidentState = memory.rebuild;

// for shipping/'s grace window, wired in src/index.js (FR-72)
export const hasOpenIncident = memory.isAlerting;
