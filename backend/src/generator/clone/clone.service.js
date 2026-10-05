import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { simpleGit, GitError } from 'simple-git';
import { AppError } from '../../utils/AppError.js';

// opts: { workspaceDir, timeoutMs }
// clones into <workspaceDir>/<deploymentId> and returns { dir, commitSha }
export async function cloneRepo(cloneUrl, deploymentId, opts) {
  const dir = path.join(opts.workspaceDir, deploymentId);

  await mkdir(opts.workspaceDir, { recursive: true });
  await rm(dir, { recursive: true, force: true });

  const git = simpleGit({ timeout: { block: opts.timeoutMs } }).env(gitEnv());

  try {
    // shallow clone - we only need the latest tree, not the history
    await git.clone(cloneUrl, dir, ['--depth', '1', '--single-branch']);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw new AppError(cloneFailureReason(err));
  }

  const commitSha = (await simpleGit(dir).revparse(['HEAD'])).trim();
  return { dir, commitSha };
}

// Don't just spread process.env here. simple-git refuses to run at all if it
// sees GIT_EDITOR / GIT_ASKPASS etc. in the env, and VS Code's terminal sets
// those. So only pass what git actually needs to reach github.
const PASS_THROUGH = [
  'PATH',
  'HOME',
  'SystemRoot', // windows
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
];

function gitEnv() {
  // without GIT_TERMINAL_PROMPT=0 git sits there waiting for a username when
  // the repo is private or the url is wrong, and the request hangs until timeout
  const env = { GIT_TERMINAL_PROMPT: '0' };
  for (const key of PASS_THROUGH) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function cloneFailureReason(err) {
  const msg = err instanceof Error ? err.message : String(err);

  if (/could not read Username|Authentication failed|not found/i.test(msg)) {
    return 'Repository not found or not public';
  }
  if (err instanceof GitError && /block timeout/i.test(msg)) {
    return 'Clone timed out';
  }
  return `git clone failed: ${msg.split('\n')[0]}`;
}
