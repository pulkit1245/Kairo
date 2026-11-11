import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { env } from '../config/env.config.js';
import { prisma } from '../db/index.js';
import { errorMessage } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';

// The public link (FR-40, FR-41, architecture 9.5): one Cloudflare quick
// tunnel per running app, a `cloudflared` process on the laptop pointed at
// Traefik on localhost with the app's host header, so the request reaches
// the app's Ingress like any other and is counted (FR-39).
//
//   start: spawn cloudflared -> it prints https://<words>.trycloudflare.com
//          -> once it says "Registered tunnel connection" the link works,
//          and it is saved as App.publicUrl
//   dies:  publicUrl cleared, a new process after 2 s (longer if it keeps
//          dying, never over 20 s), new link saved: within 30 s (FR-41)
//   stuck: no working link 25 s after starting -> killed, same as dying
//   stop:  on delete (FR-65) and when the backend shuts down
//
// Quick tunnels need no Cloudflare account; the link changes every time the
// process starts. Kairo's own dashboard and API are never tunnelled (FR-42).

const log = createLogger('tunnel');

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const READY_RE = /Registered tunnel connection/;
// marks Kairo's processes, so leftovers from a crashed backend can be found
const HOST_SUFFIX = '.kairo.local';

const timing = {
  restartDelayMs: 2000,
  maxRestartDelayMs: 20_000,
  readyWithinMs: 25_000,
  // a process that dies sooner than this after working counts as failing again
  stableAfterMs: 60_000,
};

// slug -> { app, child, url, pendingUrl, failures, readyTimer, restartTimer, stopping, startedAt }
const tunnels = new Map();
let spawn = nodeSpawn;
let missingBinary = false;

export function tunnelArgs(slug) {
  return ['tunnel', '--no-autoupdate', '--url', env.traefikUrl, '--http-host-header', `${slug}${HOST_SUFFIX}`];
}

/**
 * Starts the app's tunnel unless it has one. Never throws; a failure is
 * logged and retried.
 * @param {{ id: string, slug: string }} app
 */
export function startTunnel(app) {
  if (!env.tunnelsEnabled || missingBinary) return;
  if (tunnels.has(app.slug)) return;
  const entry = { app: { id: app.id, slug: app.slug }, child: null, url: null, pendingUrl: null, failures: 0, stopping: false };
  tunnels.set(app.slug, entry);
  launch(entry);
}

function launch(entry) {
  const { slug } = entry.app;
  entry.url = null;
  entry.pendingUrl = null;
  entry.startedAt = Date.now();
  let child;
  try {
    child = spawn(env.cloudflaredPath, tunnelArgs(slug), { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return onExit(entry, null, `could not start: ${errorMessage(err)}`);
  }
  entry.child = child;

  // cloudflared logs to stderr; read both, line by line
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    createInterface({ input: stream }).on('line', (line) => onLine(entry, child, line));
  }
  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      // not installed: retrying won't help
      missingBinary = true;
      log.error(`cloudflared not found at "${env.cloudflaredPath}"; public links are off. Install it or set CLOUDFLARED_PATH`);
      stopTunnel(slug);
      return;
    }
    log.warn(`${slug}: cloudflared error: ${errorMessage(err)}`);
  });
  child.on('exit', (code, signal) => {
    if (entry.child !== child) return;
    onExit(entry, child, `exited (${signal ?? `code ${code}`})`);
  });

  entry.readyTimer = setTimeout(() => {
    if (entry.child !== child || entry.url) return;
    log.warn(`${slug}: no working link ${timing.readyWithinMs / 1000} s after starting cloudflared; restarting it`);
    child.kill('SIGTERM');
  }, timing.readyWithinMs);
  entry.readyTimer.unref?.();
}

function onLine(entry, child, line) {
  if (entry.child !== child || entry.stopping) return;
  const url = !entry.pendingUrl && line.match(URL_RE)?.[0];
  if (url) entry.pendingUrl = url;
  // the link answers once the first connection to Cloudflare is up
  if (!entry.url && entry.pendingUrl && READY_RE.test(line)) {
    entry.url = entry.pendingUrl;
    clearTimeout(entry.readyTimer);
    log.info(`${entry.app.slug}: public link ${entry.url} (${Math.round((Date.now() - entry.startedAt) / 1000)} s)`);
    savePublicUrl(entry.app, entry.url);
  }
}

function onExit(entry, child, why) {
  clearTimeout(entry.readyTimer);
  entry.child = null;
  if (entry.stopping || tunnels.get(entry.app.slug) !== entry) return;
  const { slug } = entry.app;

  // a tunnel that worked for a while starts over at the short delay
  const lived = Date.now() - entry.startedAt;
  entry.failures = entry.url && lived >= timing.stableAfterMs ? 1 : entry.failures + 1;
  const delay = Math.min(timing.restartDelayMs * 2 ** (entry.failures - 1), timing.maxRestartDelayMs);
  log.warn(`${slug}: cloudflared ${why}; restarting in ${delay / 1000} s`);
  // the old link is dead now; the page shows none until the new one works
  if (entry.url) savePublicUrl(entry.app, null);
  entry.url = null;

  entry.restartTimer = setTimeout(() => {
    if (tunnels.get(slug) === entry && !entry.stopping) launch(entry);
  }, delay);
  entry.restartTimer.unref?.();
}

/** Stops the app's tunnel; it isn't restarted. Returns whether there was one. */
export function stopTunnel(slug) {
  const entry = tunnels.get(slug);
  if (!entry) return false;
  entry.stopping = true;
  clearTimeout(entry.readyTimer);
  clearTimeout(entry.restartTimer);
  tunnels.delete(slug);
  entry.child?.kill('SIGTERM');
  log.info(`${slug}: tunnel stopped`);
  return true;
}

// when the backend shuts down
export function stopAllTunnels() {
  for (const slug of [...tunnels.keys()]) stopTunnel(slug);
}

/** 'starting' | 'up' | 'restarting' | null (no tunnel), for the app page */
export function tunnelState(slug) {
  const entry = tunnels.get(slug);
  if (!entry) return null;
  if (entry.url) return 'up';
  return entry.child ? 'starting' : 'restarting';
}

/**
 * On boot: links from before are dead (each process makes a new one), and a
 * backend that crashed may have left its cloudflared processes running.
 * Then every live app with an active release gets its tunnel.
 */
export async function startTunnelsAtBoot() {
  if (!env.tunnelsEnabled) {
    log.info('public links are off (TUNNELS_ENABLED=false)');
    return 0;
  }
  await killLeftovers();
  await prisma.app.updateMany({ where: { publicUrl: { not: null } }, data: { publicUrl: null } });
  const apps = await prisma.app.findMany({
    where: { deletedAt: null, releases: { some: { status: 'ACTIVE' } } },
    select: { id: true, slug: true },
  });
  for (const app of apps) startTunnel(app);
  return apps.length;
}

// cloudflared processes started by an earlier backend: their command line
// ends with the --http-host-header Kairo gives them
function killLeftovers() {
  return new Promise((resolve) => {
    execFile('pkill', ['-f', `cloudflared tunnel --no-autoupdate --url .* --http-host-header [a-z0-9-]+\\${HOST_SUFFIX}$`], (err) => {
      // pkill exits 1 when nothing matched
      if (!err) log.info('stopped cloudflared processes left by an earlier run');
      resolve();
    });
  });
}

function savePublicUrl(app, publicUrl) {
  // updateMany: a deleted app is left alone
  prisma.app
    .updateMany({ where: { id: app.id, deletedAt: null }, data: { publicUrl } })
    .catch((err) => log.warn(`${app.slug}: could not save the public link: ${errorMessage(err)}`));
}

// tests: a fake cloudflared and shorter delays
export function _setSpawn(fn) {
  spawn = fn ?? nodeSpawn;
  missingBinary = false;
}
export function _setTiming(t) {
  Object.assign(timing, t);
}
export function _reset() {
  stopAllTunnels();
  missingBinary = false;
}
