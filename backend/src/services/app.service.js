import { prisma } from '../db/index.js';
import { toAppDto, toAppSummaryDto, toIncidentDto } from '../models/dto.mapper.js';
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
const INCIDENTS_SHOWN = 20;

// GET /api/apps: the Apps list (Stitch 06). Live apps only, deleted ones are
// hidden (FR-65); apps whose onboarding failed are listed with the failed step
export async function listApps() {
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
        now: live ? await appSnapshot(row) : null,
      });
    }),
  );
  // running apps first, then the ones whose onboarding didn't finish; oldest first in each
  apps.sort((a, b) => Boolean(b.release) - Boolean(a.release));
  return { apps, running: apps.filter((a) => a.release).length, maxRunning: MAX_RUNNING_APPS, cluster: await cluster };
}

// GET /api/apps/:slug: the app page (P2c header, P3 fills in the rest)
export async function getApp(slug) {
  const app = await prisma.app.findFirst({
    where: { slug, deletedAt: null },
    include: {
      releases: { orderBy: { deployedAt: 'desc' } },
      pipelineRuns: { orderBy: { startedAt: 'desc' }, take: 1 },
    },
  });
  if (!app) throw new NotFoundError('App');
  const incidents = await listIncidents(INCIDENTS_SHOWN, { appId: app.id });
  return toAppDto(
    { ...app, releases: app.releases.slice(0, RELEASES_SHOWN) },
    {
      graceMs: GRACE_MS,
      storedImages: storedImages(app.releases),
      attentionReason: app.health === 'NEEDS_ATTENTION' ? attentionReason(slug) : null,
      traffic: trafficStatus(slug),
      incidents,
      tunnel: tunnelState(slug),
      // judged against every release, not just the ones shown (pruning keeps 3)
      rollbackBlocked: (r) => rollbackBlocked(app, r),
    },
  );
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

// GET /api/incidents/:id: the incident drawer (Stitch 08), the incident plus
// its pods' memory around it
export async function getIncident(id) {
  const row = await findIncident(id);
  if (!row) throw new NotFoundError('Incident');
  return { ...toIncidentDto(row), memory: await incidentMemory(row, row.app) };
}

export { deleteApp } from './delete.service.js';
