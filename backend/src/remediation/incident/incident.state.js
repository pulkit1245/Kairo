import { prisma } from '../../db/index.js';
import { appNamespace } from '../../utils/appNames.js';
import { errorMessage } from '../../utils/AppError.js';
import { createLogger } from '../../utils/logger.js';
import { decideAction } from '../action/decision.service.js';

// FR-74: decisions use memory, not the database, so a database outage never
// blocks healing. The memory is rebuilt from the database at boot.
//
//   open: fingerprint -> { incidentId, pending, slug, deferred }
//     incidentId is set once the incident is in the database. pending holds the
//     whole record while it isn't (the write failed), so it can still be saved
//     later, when the alert resolves. deferred is { action, target } for an
//     alert that fired during a grace window: its action waits for the window
//     to end (FR-71).
//   apps: slug -> { id, slug, namespace }

const log = createLogger('incidents');

const open = new Map();
const apps = new Map();
// writes that failed even after their retry, for flushUnsaved() to try again:
//   { kind: 'save', record, resolvedAt }   an incident that never reached the database
//   { kind: 'resolve', fingerprint, resolvedAt }   an incident in the database still OPEN
//   { kind: 'attempt', incidentId, attempt }   a deferred action that ran later
let outbox = [];

export function queueWrite(item) {
  outbox.push(item);
}

// hands over everything queued; whatever fails again is queued again
export function takeOutbox() {
  const items = outbox;
  outbox = [];
  return items;
}

// open incidents whose record isn't in the database yet
export function unsavedOpen() {
  return [...open.entries()].filter(([, e]) => e.pending).map(([fingerprint, e]) => ({ fingerprint, record: e.pending }));
}

export function unsavedCount() {
  return outbox.length + unsavedOpen().length;
}

export function isOpen(fingerprint) {
  return open.has(fingerprint);
}

export function markOpen(fingerprint, pending, deferred = null) {
  open.set(fingerprint, { incidentId: null, pending, slug: pending.slug, deferred });
}

export function markRecorded(fingerprint, incidentId) {
  const entry = open.get(fingerprint);
  if (entry) open.set(fingerprint, { ...entry, incidentId, pending: null });
}

export const getOpen = (fingerprint) => open.get(fingerprint);

// FR-71: the open alerts of an app whose action waits for its grace window
export function deferredFor(slug) {
  return [...open.entries()].filter(([, e]) => e.slug === slug && e.deferred).map(([fingerprint]) => fingerprint);
}

// hands over the deferred action, once
export function takeDeferred(fingerprint) {
  const entry = open.get(fingerprint);
  const deferred = entry?.deferred ?? null;
  if (entry) entry.deferred = null;
  return deferred;
}

// FR-72: is any Kairo alert open for this app? Read at the end of a grace window
export function isAlerting(slug) {
  for (const e of open.values()) if (e.slug === slug) return true;
  return false;
}

// removes and returns the entry, so the resolve path knows if a record is still unsaved
export function close(fingerprint) {
  const entry = open.get(fingerprint);
  open.delete(fingerprint);
  return entry;
}

export function rememberApp(app) {
  apps.set(app.slug, { id: app.id, slug: app.slug, namespace: app.namespace });
}

// The app an alert belongs to: memory, then the database. If the database is
// down and the app isn't in memory, trust the alert when its namespace is the
// one Kairo gives that slug: only Kairo's generated rules produce that pair.
// Returns null for an app Kairo doesn't know.
export async function findApp(slug, namespace) {
  const known = apps.get(slug);
  if (known) return known;

  try {
    const app = await prisma.app.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, slug: true, namespace: true },
    });
    if (!app) return null;
    rememberApp(app);
    return apps.get(slug);
  } catch (err) {
    if (namespace && namespace === appNamespace(slug)) {
      log.warn(`database unreachable (${errorMessage(err)}); acting on ${slug} from its namespace`);
      return { id: null, slug, namespace };
    }
    throw err;
  }
}

// at boot: every open incident and every live app
export async function rebuild() {
  open.clear();
  apps.clear();
  const [incidents, liveApps] = await Promise.all([
    prisma.incident.findMany({
      where: { status: 'OPEN' },
      select: {
        id: true,
        fingerprint: true,
        alertName: true,
        cause: true,
        pod: true,
        app: { select: { slug: true, namespace: true } },
        _count: { select: { attempts: true } },
      },
    }),
    prisma.app.findMany({ where: { deletedAt: null }, select: { id: true, slug: true, namespace: true } }),
  ]);
  for (const i of incidents) {
    // an open incident with no attempt was deferred during a grace window; it
    // waits again, for the rebuilt window or the alert's next repeat
    const deferred = i._count.attempts
      ? null
      : {
          action: decideAction(i.alertName, i.cause).action,
          target: { alertName: i.alertName, pod: i.pod ?? null },
        };
    open.set(i.fingerprint, { incidentId: i.id, pending: null, slug: i.app.slug, deferred });
  }
  for (const a of liveApps) rememberApp(a);
  return { openIncidents: incidents.length, apps: liveApps.length };
}

// for tests
export function _reset() {
  open.clear();
  apps.clear();
  outbox = [];
}
