import http from 'node:http';
import { env } from '../config/env.config.js';
import { appHost } from '../utils/appNames.js';
import { AppError } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';

// Send Traffic (FR-62): requests at the app through Traefik, the way real
// users reach it, so Traefik's request metrics count them (FR-39). 50 per
// second for 60 s by default.
//
// Plain `/` on the sample apps costs almost no CPU, so KairoHighCpu would
// never fire. The samples have /work?ms=N, which burns N ms of CPU (FR-64):
// if the app answers it, that's what is sent, else `/`.

const log = createLogger('traffic');

export const TRAFFIC_RPS = 50; // proposed
export const TRAFFIC_SECONDS = 60;
export const WORK_PATH = '/work?ms=20';
const REQUEST_TIMEOUT_MS = 10_000;

const runs = new Map(); // slug -> { path, startedAt, endsAt, sent, ok, failed, timer }

// node's fetch won't send a Host header of our own; http.request will
function send(slug, path, agent) {
  const url = new URL(env.traefikUrl);
  return new Promise((resolve) => {
    const req = http.request(
      { host: url.hostname, port: url.port || 80, path, method: 'GET', headers: { Host: appHost(slug) }, agent, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(0));
    req.end();
  });
}

/** @returns {{ path: string, rps: number, startedAt: string, endsAt: string }} */
export async function startTraffic(slug, { rps = TRAFFIC_RPS, seconds = TRAFFIC_SECONDS } = {}) {
  if (runs.has(slug)) throw new AppError('Traffic is already being sent to this app', 409);
  const agent = new http.Agent({ keepAlive: true, maxSockets: rps * 2 });
  const path = (await send(slug, '/work?ms=1', agent)) === 200 ? WORK_PATH : '/';

  const startedAt = Date.now();
  const run = { path, startedAt, endsAt: startedAt + seconds * 1000, sent: 0, ok: 0, failed: 0, agent };
  runs.set(slug, run);
  run.timer = setInterval(() => {
    if (Date.now() >= run.endsAt) return stop(slug, agent);
    run.sent++;
    send(slug, path, agent).then((code) => (code >= 200 && code < 400 ? run.ok++ : run.failed++));
  }, 1000 / rps);
  run.timer.unref();
  log.info(`${slug}: sending ${rps} req/s of GET ${path} for ${seconds} s`);
  return { path, rps, startedAt: new Date(startedAt).toISOString(), endsAt: new Date(run.endsAt).toISOString() };
}

// FR-65: a deleted app gets no more traffic
export function stopTraffic(slug) {
  const run = runs.get(slug);
  if (run) stop(slug, run.agent);
}

function stop(slug, agent) {
  const run = runs.get(slug);
  if (!run) return;
  clearInterval(run.timer);
  runs.delete(slug);
  last.set(slug, summary(run, false));
  // let the last requests finish before closing the sockets
  setTimeout(() => agent.destroy(), REQUEST_TIMEOUT_MS).unref();
  log.info(`${slug}: traffic done, ${run.sent} sent, ${run.ok} ok, ${run.failed} failed`);
}

const last = new Map(); // slug -> the summary of the last finished run

const summary = (run, running) => ({
  running,
  path: run.path,
  startedAt: new Date(run.startedAt).toISOString(),
  endsAt: new Date(run.endsAt).toISOString(),
  sent: run.sent,
  ok: run.ok,
  failed: run.failed,
});

// for the app page: the run going now, else the last one, else null
export function trafficStatus(slug) {
  const run = runs.get(slug);
  return run ? summary(run, true) : (last.get(slug) ?? null);
}
