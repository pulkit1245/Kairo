import { prisma } from '../db/index.js';
import { RESOURCES } from '../generator/template/config.service.js';
import { MAX_REPLICAS } from '../remediation/action/executor.service.js';
import { queryNumber, queryRange } from '../prometheus/prometheus.client.js';
import { AppError, errorMessage, NotFoundError } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';

// The app page's numbers (FR-56) and the incident drawer's memory chart.
// Every query is written here; a request only picks the app or the incident,
// never query text (FR-57). The browser never talks to Prometheus.

const log = createLogger('metrics');

export const WINDOW_SEC = 30 * 60; // FR-56: the last 30 minutes
export const STEP_SEC = 15; // Prometheus scrapes every 15 s
const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024; // RESOURCES.memoryLimit, 256Mi
const MAX_PODS_CHARTED = 6;

// the fixed queries for one app. Traefik names the service
// <namespace>-<app>-<port>@kubernetes; the alert rules match it the same way
export function appQueries({ namespace, slug }) {
  const traefik = `service=~"${namespace}-${slug}-.*"`;
  const app = `namespace="${namespace}", container="${slug}"`;
  const deployment = `namespace="${namespace}", deployment="${slug}"`;
  const requests = `sum(rate(traefik_service_requests_total{${traefik}}[1m]))`;
  return {
    // requests per second through Traefik, all pods
    rps: requests,
    // share of answers that were 5xx; no traffic -> NaN -> null
    errorRate: `(sum(rate(traefik_service_requests_total{${traefik}, code=~"5.."}[1m])) or vector(0)) / ${requests}`,
    // CPU of all pods together, in cores
    cpu: `sum(rate(container_cpu_usage_seconds_total{${app}}[1m]))`,
    // the largest pod's memory, the number the 256Mi limit applies to
    memory: `max(container_memory_working_set_bytes{${app}})`,
    replicas: `max(kube_deployment_status_replicas_available{${deployment}})`,
    // instant only
    desired: `max(kube_deployment_spec_replicas{${deployment}})`,
    restarts: `round(sum(increase(kube_pod_container_status_restarts_total{${app}}[30m])))`,
  };
}

const CHARTED = ['rps', 'errorRate', 'cpu', 'memory', 'replicas'];
const NAMES = [...CHARTED, 'desired', 'restarts'];

/**
 * GET /api/apps/:slug/metrics: six KPIs and five series over the last 30 min.
 * A query that fails comes back null; if they all fail, 503.
 */
export async function appMetrics(slug, now = Date.now()) {
  const app = await prisma.app.findFirst({ where: { slug, deletedAt: null }, select: { slug: true, namespace: true } });
  if (!app) throw new NotFoundError('App');
  const q = appQueries(app);
  // whole steps, so two refreshes line up and the chart doesn't jitter
  const endSec = Math.floor(now / 1000 / STEP_SEC) * STEP_SEC;
  const range = { startSec: endSec - WINDOW_SEC, endSec, stepSec: STEP_SEC };

  const jobs = [
    ...CHARTED.map((k) => queryRange(q[k], range).then((r) => r[0]?.points ?? [])),
    queryNumber(q.desired),
    queryNumber(q.restarts),
  ];
  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length === results.length) {
    log.warn(`${slug}: Prometheus didn't answer: ${errorMessage(failed[0].reason)}`);
    throw new AppError("Prometheus isn't answering. Is the port-forward on localhost:9090 running?", 503);
  }
  const value = (i) => (results[i].status === 'fulfilled' ? results[i].value : null);

  const series = Object.fromEntries(CHARTED.map((k, i) => [k, value(i)]));
  // the KPI is the newest sample of its series
  const latest = (points) => {
    if (!points) return null;
    for (let i = points.length - 1; i >= 0; i--) if (points[i][1] !== null) return points[i][1];
    return null;
  };
  return {
    window: range,
    now: {
      rps: latest(series.rps),
      errorRate: latest(series.errorRate),
      cpuCores: latest(series.cpu),
      memoryBytes: latest(series.memory),
      replicasReady: latest(series.replicas),
      replicasDesired: value(CHARTED.length),
      restarts: value(CHARTED.length + 1),
    },
    limits: { cpuCoresPerPod: RESOURCES.cpuLimitCores, memoryBytesPerPod: MEMORY_LIMIT_BYTES, maxReplicas: MAX_REPLICAS },
    series,
    // which numbers are missing because their query failed
    failed: NAMES.filter((_, i) => results[i].status === 'rejected'),
  };
}

/**
 * The incident drawer's memory chart (Stitch 08): each of the app's pods
 * from 5 minutes before the alert to 3 minutes after it resolved (or now),
 * so the old pod ending and its replacement starting are both visible.
 */
export async function incidentMemory(incident, app, now = Date.now()) {
  const startSec = Math.floor(incident.startedAt.getTime() / 1000) - 5 * 60;
  const until = incident.resolvedAt ? incident.resolvedAt.getTime() + 3 * 60_000 : now;
  const endSec = Math.max(startSec + 60, Math.floor(Math.min(until, now) / 1000));
  // at most ~240 points, at least one per scrape
  const stepSec = Math.max(STEP_SEC, Math.ceil((endSec - startSec) / 240 / STEP_SEC) * STEP_SEC);
  const range = { startSec, endSec, stepSec };
  const expr = `max by (pod) (container_memory_working_set_bytes{namespace="${app.namespace}", container="${app.slug}"})`;
  let pods = [];
  let error = null;
  try {
    pods = (await queryRange(expr, range)).map((s) => ({ pod: s.labels.pod, points: s.points }));
  } catch (err) {
    error = "Prometheus isn't answering";
    log.warn(`memory for incident ${incident.id}: ${errorMessage(err)}`);
  }
  const focus = incident.pod ?? null;
  // the incident's pod first, then the rest by when they appear
  pods.sort((a, b) => (b.pod === focus) - (a.pod === focus) || firstSeen(a) - firstSeen(b));
  return { ...range, limitBytes: MEMORY_LIMIT_BYTES, pod: focus, pods: pods.slice(0, MAX_PODS_CHARTED), error };
}

const firstSeen = (s) => s.points.find((p) => p[1] !== null)?.[0] ?? Infinity;
