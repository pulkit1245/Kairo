import { spawn as nodeSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { env } from '../config/env.config.js';
import { createLogger } from '../utils/logger.js';

// Kairo reaches Prometheus through a local port-forward (FR-57). The backend
// keeps that forward open itself, so the dashboard's charts, numbers and the
// cluster card come back on their own after a restart of the Mac, Docker
// Desktop or Prometheus, with nobody running kubectl by hand.
//
//   start:  at boot, if Prometheus doesn't answer on PROMETHEUS_URL, spawn
//           kubectl port-forward svc/prometheus-server <port>:80, bound to
//           127.0.0.1 only, as kairo-platform (the backend's own kubeconfig,
//           allowed only this by its RBAC, infra/rbac/main.tf)
//   watch:  every CHECK_MS ask Prometheus /-/ready (short timeout)
//   dies:   kubectl exited (Docker Desktop restarting, the API down): start it
//           again after a wait that grows 2 s, 4 s ... up to 30 s
//   stuck:  kubectl still running but not forwarding (after Prometheus's pod
//           restarts it keeps running and fails every connection): two failed
//           checks in a row -> killed and started again
//   stop:   on shutdown
//
// A forward someone else opened (npm run prom:forward) is used as it is; if
// it goes away, Kairo opens its own.

const log = createLogger('prometheus');

export const NAMESPACE = 'monitoring';
export const SERVICE = 'prometheus-server';
export const SERVICE_PORT = 80;

export const timing = {
  checkMs: 10_000,
  readyTimeoutMs: 2000,
  // a fresh forward gets this long before a failed check counts
  startGraceMs: 8000,
  backoffStartMs: 2000,
  backoffMaxMs: 30_000,
};

let spawn = nodeSpawn;
let readyFn = isReady;

const s = {
  child: null,
  startedAt: 0,
  failures: 0,
  backoff: timing.backoffStartMs,
  restarts: 0,
  stopping: false,
  timer: null,
  retry: null,
  lastError: null,
  // 'off' | 'starting' | 'up' | 'external' | 'down'
  state: 'off',
};

// where PROMETHEUS_URL points, if it's this machine
export function localTarget(url = env.prometheusUrl) {
  try {
    const u = new URL(url);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
    return { port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) };
  } catch {
    return null;
  }
}

export function forwardArgs(port) {
  return ['-n', NAMESPACE, 'port-forward', `svc/${SERVICE}`, `${port}:${SERVICE_PORT}`, '--address', '127.0.0.1'];
}

async function isReady() {
  try {
    const res = await fetch(`${env.prometheusUrl}/-/ready`, { signal: AbortSignal.timeout(timing.readyTimeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/** GET /api/health's prometheus field */
export function prometheusForwardState() {
  return { state: s.state, restarts: s.restarts, detail: s.state === 'down' ? s.lastError : null };
}

export async function startPrometheusForward() {
  if (!env.prometheusForward) {
    log.info('port-forward off (PROMETHEUS_PORT_FORWARD=false)');
    return;
  }
  const target = localTarget();
  if (!target) {
    log.info(`PROMETHEUS_URL ${env.prometheusUrl} isn't on this machine; no port-forward`);
    return;
  }
  s.stopping = false;
  if (await readyFn()) {
    s.state = 'external';
    log.info(`Prometheus already answers on ${env.prometheusUrl}; using that, and watching it`);
  } else {
    open(target.port);
  }
  s.timer = setInterval(() => check(target.port).catch(() => {}), timing.checkMs);
  s.timer.unref?.();
}

async function check(port) {
  if (s.stopping) return;
  if (await readyFn()) {
    if (s.state !== 'up' && s.state !== 'external') log.info(`Prometheus answering on ${env.prometheusUrl}`);
    if (s.child) s.state = 'up';
    s.failures = 0;
    s.backoff = timing.backoffStartMs;
    return;
  }
  s.failures++;
  if (s.child && Date.now() - s.startedAt < timing.startGraceMs) return; // still connecting
  if (s.child && s.failures >= 2) {
    log.warn('the port-forward is running but Prometheus doesn\'t answer through it; restarting it');
    s.child.kill('SIGTERM');
    return; // its exit schedules the new one
  }
  if (!s.child && !s.retry) {
    if (s.state === 'external') log.warn('the port-forward Kairo was using went away; opening its own');
    open(port);
  }
}

function open(port) {
  if (s.stopping) return;
  s.state = 'starting';
  s.startedAt = Date.now();
  s.failures = 0;
  let child;
  try {
    child = spawn(env.kubectlPath, forwardArgs(port), { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    s.lastError = err.message;
    scheduleRetry(port);
    return;
  }
  s.child = child;
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (/^Forwarding from/.test(line)) log.info(`port-forward open: ${line.trim()}`);
  });
  createInterface({ input: child.stderr }).on('line', (line) => {
    s.lastError = line.trim().slice(0, 200);
    log.debug(`kubectl: ${s.lastError}`);
  });
  child.on('error', (err) => {
    s.lastError = err.code === 'ENOENT' ? `${env.kubectlPath} not found (KUBECTL_PATH)` : err.message;
  });
  child.on('exit', (code, signal) => {
    if (s.child === child) s.child = null;
    if (s.stopping) return;
    s.state = 'down';
    log.warn(`port-forward ended (${signal ?? `exit ${code}`}${s.lastError ? `: ${s.lastError}` : ''}); opening it again in ${Math.round(s.backoff / 1000)} s`);
    scheduleRetry(port);
  });
}

function scheduleRetry(port) {
  if (s.stopping || s.retry) return;
  const wait = s.backoff;
  s.backoff = Math.min(s.backoff * 2, timing.backoffMaxMs);
  s.restarts++;
  s.retry = setTimeout(() => {
    s.retry = null;
    open(port);
  }, wait);
  s.retry.unref?.();
}

export function stopPrometheusForward() {
  s.stopping = true;
  clearInterval(s.timer);
  clearTimeout(s.retry);
  s.timer = s.retry = null;
  s.child?.kill('SIGTERM');
  s.child = null;
  s.state = 'off';
}

// tests
export function _setDeps({ spawn: sp = nodeSpawn, ready = isReady } = {}) {
  spawn = sp;
  readyFn = ready;
}
export const _state = s;
export const _check = (port) => check(port);
export function _reset() {
  stopPrometheusForward();
  Object.assign(s, { failures: 0, backoff: timing.backoffStartMs, restarts: 0, stopping: false, lastError: null, startedAt: 0 });
}
