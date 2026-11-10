import { spawn } from 'node:child_process';

// BUILDING (FR-27, FR-28): docker build with Docker Desktop's engine. The
// kubeadm cluster uses the same engine, so the image is visible to it at once,
// with no registry. The docker CLI is used directly, so no new dependency.

export const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
export const LOG_TAIL_LINES = 80;

// Only what the docker CLI needs. Same idea as the git env in clone.service.js:
// don't hand the whole backend environment (tokens, database URL) to a build.
const PASS_THROUGH = ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'TMPDIR'];

function dockerEnv() {
  const env = { DOCKER_BUILDKIT: '1', NO_COLOR: '1' };
  for (const key of PASS_THROUGH) if (process.env[key]) env[key] = process.env[key];
  return env;
}

// keeps the newest `max` lines, dropping ANSI colour codes
export function lineTail(max = LOG_TAIL_LINES) {
  const lines = [];
  let partial = '';
  return {
    push(chunk) {
      const text = partial + chunk.toString('utf8').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
      const parts = text.split(/\r?\n/);
      partial = parts.pop();
      for (const line of parts) {
        lines.push(line);
        if (lines.length > max) lines.shift();
      }
    },
    lines() {
      const all = partial ? [...lines, partial] : [...lines];
      return all.slice(-max);
    },
  };
}

// Resolves { ok: true } or { ok: false, reason, logTail }. Never throws for a
// failed build: a failure is a normal outcome the pipeline records.
export function buildImage({ contextDir, dockerfile, tag, timeoutMs = BUILD_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const tail = lineTail();
    let timedOut = false;

    const child = spawn(
      'docker',
      ['build', '--progress=plain', '--file', dockerfile, '--tag', tag, contextDir],
      { env: dockerEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.on('data', (c) => tail.push(c));
    child.stderr.on('data', (c) => tail.push(c));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // docker usually stops at once; make sure it does
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      const reason = err.code === 'ENOENT' ? 'Docker CLI not found on this machine' : `Could not start docker: ${err.message}`;
      resolve({ ok: false, reason, logTail: tail.lines() });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) return resolve({ ok: true });
      const reason = timedOut
        ? `Build timed out after ${Math.round(timeoutMs / 60000)} minutes`
        : `Build failed (docker exited with code ${code})`;
      resolve({ ok: false, reason, logTail: tail.lines() });
    });
  });
}
