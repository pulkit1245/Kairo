import { prisma } from '../../db/index.js';
import { appNamespace } from '../../utils/appNames.js';
import { errorMessage } from '../../utils/AppError.js';
import { createLogger } from '../../utils/logger.js';

// FR-74: decisions use memory, not the database, so a database outage never
// blocks healing. The memory is rebuilt from the database at boot.
//
//   open: fingerprint -> { incidentId, pending }
//     incidentId is set once the incident is in the database. pending holds the
//     whole record while it isn't (the write failed), so it can still be saved
//     later, when the alert resolves.
//   apps: slug -> { id, slug, namespace }

const log = createLogger('incidents');

const open = new Map();
const apps = new Map();

export function isOpen(fingerprint) {
  return open.has(fingerprint);
}

export function markOpen(fingerprint, pending) {
  open.set(fingerprint, { incidentId: null, pending });
}

export function markRecorded(fingerprint, incidentId) {
  const entry = open.get(fingerprint);
  if (entry) open.set(fingerprint, { incidentId, pending: null });
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
    prisma.incident.findMany({ where: { status: 'OPEN' }, select: { id: true, fingerprint: true } }),
    prisma.app.findMany({ where: { deletedAt: null }, select: { id: true, slug: true, namespace: true } }),
  ]);
  for (const i of incidents) open.set(i.fingerprint, { incidentId: i.id, pending: null });
  for (const a of liveApps) rememberApp(a);
  return { openIncidents: incidents.length, apps: liveApps.length };
}

// for tests
export function _reset() {
  open.clear();
  apps.clear();
}
