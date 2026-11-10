import { spawn } from 'node:child_process';

// The docker CLI, used directly (no new dependency) for builds (generator/) and
// image pruning (shipping/).

// Only what the docker CLI needs. Same idea as the git env in clone.service.js:
// don't hand the whole backend environment (tokens, database URL) to docker.
const PASS_THROUGH = ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'TMPDIR'];

export function dockerEnv() {
  const env = { DOCKER_BUILDKIT: '1', NO_COLOR: '1' };
  for (const key of PASS_THROUGH) if (process.env[key]) env[key] = process.env[key];
  return env;
}

// Runs one short docker command. Resolves { code, output }, never throws.
export function docker(args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn('docker', args, { env: dockerEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, output: err.code === 'ENOENT' ? 'Docker CLI not found on this machine' : err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output: output.trim() });
    });
  });
}
