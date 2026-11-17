import { prisma } from '../db/index.js';
import { rollbackOffers, toAppDto, toAppSummaryDto, toIncidentDto, toReleaseDto } from '../models/dto.mapper.js';
import { GRACE_MS } from '../shipping/grace.service.js';
import { storedImages } from '../shipping/prune.service.js';
import { attentionReason, setAutoHealState } from '../remediation/healing/healing.state.js';
import { rollbackBlocked } from '../remediation/healing/rollback.service.js';
import { findIncident, listIncidents } from '../remediation/incident/incident.service.js';
import { appSnapshot, clusterSnapshot, incidentMemory } from './metrics.service.js';
import { startTraffic, trafficStatus } from '../testpanel/traffic.service.js';
import { tunnelState } from '../tunnel/tunnel.service.js';
import { AppError, NotFoundError } from '../utils/AppError.js';
import { MAX_RUNNING_APPS } from './deployment.service.js';

// How many releases the app page lists. Pruning keeps 3 images (FR-38); the
// rest stay listed so the history reads right, marked as no longer stored.
const RELEASES_SHOWN = 10;

// GET /api/apps: the Apps list (Stitch 06). Live apps only, deleted ones are
// hidden (FR-65); apps whose onboarding failed are listed with the failed step.
// `numbers: false` (?numbers=false) leaves out each app's Prometheus figures:
// the sidebar on the app screens shows only health and the cluster card (P5d)
export async function listApps({ numbers = true } = {}) {
  // the cluster card's numbers, alongside: at most CLUSTER_TIMEOUT_MS, never an error
  const cluster = clusterSnapshot();
  const rows = await prisma.app.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    include: {
      releases: { where: { status: 'ACTIVE' }, orderBy: { deployedAt: 'desc' }, take: 1 },
      pipelineRuns: { orderBy: { startedAt: 'desc' }, take: 1 },
      incidents: { orderBy: { startedAt: 'desc' }, take: 1 },
      // the sidebar's Incidents badge
      _count: { select: { incidents: { where: { status: 'OPEN' } } } },
    },
  });
  const apps = await Promise.all(
    rows.map(async (row) => {
      const live = row.releases.length > 0;
      return toAppSummaryDto(row, {
        attentionReason: row.health === 'NEEDS_ATTENTION' ? attentionReason(row.slug) : null,
        tunnel: tunnelState(row.slug),
        // only apps with something deployed have numbers
        now: live && numbers ? await appSnapshot(row) : null,
      });
    }),
  );
  // running apps first, then the ones whose onboarding didn't finish; oldest first in each
  apps.sort((a, b) => Boolean(b.release) - Boolean(a.release));
  return { apps, running: apps.filter((a) => a.release).length, maxRunning: MAX_RUNNING_APPS, cluster: await cluster };
}

// GET /api/apps/:slug: the app's header, banner and tab bar (P2c, FR-59).
// Since P5d it carries facts, not lists: the counts, the issue and whether a
// manual rollback has a target, judged over the releases the Releases screen
// lists, so the banner and that screen always agree.
export async function getApp(slug) {
  const app = await prisma.app.findFirst({
    where: { slug, deletedAt: null },
    include: {
      releases: { orderBy: { deployedAt: 'desc' } },
      pipelineRuns: { orderBy: { startedAt: 'desc' }, take: 1 },
    },
  });
  if (!app) throw new NotFoundError('App');
  const [open, total, issue] = await Promise.all([
    prisma.incident.count({ where: { appId: app.id, status: 'OPEN' } }),
    prisma.incident.count({ where: { appId: app.id } }),
    // the banner's "View GitHub issue": the newest incident that has one (FR-55)
    prisma.incident.findFirst({
      where: { appId: app.id, githubIssueNumber: { not: null } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { githubIssueNumber: true },
    }),
  ]);
  return toAppDto(
    { ...app, releases: app.releases.slice(0, RELEASES_SHOWN) },
    {
      graceMs: GRACE_MS,
      storedImages: storedImages(app.releases),
      attentionReason: app.health === 'NEEDS_ATTENTION' ? attentionReason(slug) : null,
      traffic: trafficStatus(slug),
      tunnel: tunnelState(slug),
      // judged against every release, not just the ones shown (pruning keeps 3)
      rollbackBlocked: (r) => rollbackBlocked(app, r),
      counts: { open, total },
      issue,
    },
  );
}

// a live app by slug, or 404
async function liveApp(slug, include = undefined) {
  const app = await prisma.app.findFirst({ where: { slug, deletedAt: null }, include });
  if (!app) throw new NotFoundError('App');
  return app;
}

// GET /api/apps/:slug/releases: the Releases screen (FR-60, FR-61), newest first
export async function getAppReleases(slug) {
  const app = await liveApp(slug, { releases: { orderBy: { deployedAt: 'desc' } } });
  const shown = app.releases.slice(0, RELEASES_SHOWN);
  const stored = storedImages(app.releases);
  const extra = {
    graceMs: GRACE_MS,
    // judged against every release, not just the ones shown (pruning keeps 3)
    storedImages: stored,
    rollbackBlocked: (r) => rollbackBlocked(app, r),
    // over the ones shown, as GET /api/apps/:slug counts them
    offered: rollbackOffers(shown, stored),
  };
  return {
    releases: shown.map((r) => toReleaseDto(r, extra)),
    total: app.releases.length,
  };
}

// GET /api/apps/:slug/incidents?limit=25&before=<incident id>: the Incidents
// screen and the Overview's latest few, newest first. `before` pages back
// ("Show older"): the incidents listed after that one
export const INCIDENT_PAGE = { default: 25, max: 50 };
export async function getAppIncidents(slug, { limit, before } = {}) {
  const app = await liveApp(slug);
  const n = limit === undefined ? INCIDENT_PAGE.default : Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > INCIDENT_PAGE.max) {
    throw new AppError(`limit must be a whole number from 1 to ${INCIDENT_PAGE.max}`, 400);
  }
  if (before !== undefined) {
    const from = typeof before === 'string' ? await prisma.incident.findFirst({ where: { id: before, appId: app.id }, select: { id: true } }) : null;
    if (!from) throw new AppError("before must be one of this app's incidents", 400);
  }
  // one more than asked, to know whether there are older ones
  const rows = await listIncidents(n + 1, { appId: app.id }, before);
  return { incidents: rows.slice(0, n), more: rows.length > n };
}

// PATCH /api/apps/:slug { autoHeal } (FR-51). Memory first: the next alert
// already follows it (FR-74)
export async function updateApp(slug, body) {
  if (typeof body?.autoHeal !== 'boolean') throw new AppError('autoHeal must be true or false', 400);
  const app = await prisma.app.findFirst({ where: { slug, deletedAt: null }, select: { id: true } });
  if (!app) throw new NotFoundError('App');
  setAutoHealState(slug, body.autoHeal);
  await prisma.app.update({ where: { id: app.id }, data: { autoHeal: body.autoHeal } });
  return getApp(slug);
}

// POST /api/apps/:slug/traffic (FR-62)
export async function sendTraffic(slug) {
  const app = await prisma.app.findFirst({ where: { slug, deletedAt: null }, select: { slug: true } });
  if (!app) throw new NotFoundError('App');
  return startTraffic(app.slug);
}

// GET /api/incidents/:id: the incident page (was the drawer, Stitch 08): the
// incident, its pods' memory around it, and the app's next newer and older
// incidents for Newer/Older (P5d)
export async function getIncident(id) {
  const row = await findIncident(id);
  if (!row) throw new NotFoundError('Incident');
  const [memory, newer, older] = await Promise.all([incidentMemory(row, row.app), ...neighbours(row)]);
  return { ...toIncidentDto(row), memory, newerId: newer?.id ?? null, olderId: older?.id ?? null };
}

// the same order as the lists (startedAt, then id when two start together)
function neighbours(row) {
  const q = neighbourQueries(row);
  return [prisma.incident.findFirst(q.newer), prisma.incident.findFirst(q.older)];
}

// the findFirst arguments for the app's next newer and next older incident
export function neighbourQueries(row) {
  const same = { startedAt: row.startedAt };
  const side = (cmp, dir) => ({
    where: { appId: row.appId, OR: [{ startedAt: { [cmp]: row.startedAt } }, { ...same, id: { [cmp]: row.id } }] },
    orderBy: [{ startedAt: dir }, { id: dir }],
    select: { id: true },
  });
  return { newer: side('gt', 'asc'), older: side('lt', 'desc') };
}

export { deleteApp } from './delete.service.js';
