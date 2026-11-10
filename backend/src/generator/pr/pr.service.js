import { prisma } from '../../db/index.js';
import { githubErrorMessage, installationClient, isInstallationGone } from '../../github/github.client.js';
import { endGrace, GRACE_MS, inGrace } from '../../shipping/grace.service.js';
import { AppError, NotFoundError } from '../../utils/AppError.js';
import { ghcrImage } from '../../utils/appNames.js';
import { createLogger } from '../../utils/logger.js';
import { commitMessage, PR_TITLE, prBody, SETUP_BRANCH } from './pr.body.js';

const log = createLogger('pr');

// The setup PR (FR-30 to FR-34). Opened as the App's bot once the preview is
// marked healthy, never before. All files go in one commit on kairo/setup,
// made through the Git Data API (no git push, no token in a URL). Kairo never
// writes to the default branch and never force-pushes: an existing branch gets
// a new commit on top, an existing open PR is updated, not duplicated.

const inFlight = new Set();

// shipping/'s onHealthy hook (wired in src/index.js): a healthy preview of a
// picked repo gets its PR
export async function onPreviewHealthy(release, app) {
  if (release.source !== 'PREVIEW') return;
  await openSetupPr(app.id);
}

// shipping/'s onUnhealthy hook: no PR, and the onboarding view says why (AQ11)
export async function onPreviewUnhealthy(release, app, reason) {
  if (release.source !== 'PREVIEW' || !app.installationId) return;
  if (app.prState === 'OPEN' || app.prState === 'MERGED') return; // an earlier preview already got one
  await prisma.app.update({
    where: { id: app.id },
    data: {
      prState: 'FAILED',
      prError: `The preview wasn't healthy at the end of its ${GRACE_MS / 1000} s grace window (${reason}), so Kairo didn't open the PR.`,
    },
  });
}

/** @returns {Promise<{ state: string|null, number?: number, error?: string, skipped?: string }>} */
export async function openSetupPr(appId) {
  if (inFlight.has(appId)) return { state: null, skipped: 'already being opened' };
  inFlight.add(appId);
  try {
    const app = await prisma.app.findUnique({ where: { id: appId }, include: { installation: true } });
    if (!app || app.deletedAt) return { state: null, skipped: 'no such app' };
    // URL-shortcut apps (AQ10) have no installation: preview only, no PR
    if (!app.installation || app.installation.suspendedAt) return { state: app.prState, skipped: 'not installed' };
    if (app.prState === 'MERGED') return { state: 'MERGED', skipped: 'already merged' };

    const release = await prisma.release.findFirst({
      where: { appId, status: 'ACTIVE', healthyAt: { not: null } },
      orderBy: { deployedAt: 'desc' },
    });
    if (!release) return { state: app.prState, skipped: 'no healthy release' };
    const run = await prisma.pipelineRun.findFirst({
      where: { appId, commitSha: release.commitSha, status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
      include: { files: true },
    });
    if (!run?.files.length) return { state: app.prState, skipped: 'no generated files' };

    try {
      const pr = await pushSetupPr(app, run, release);
      await prisma.app.update({
        where: { id: appId },
        data: { prNumber: pr.number, prState: 'OPEN', prError: null },
      });
      log.info(`${app.slug}: setup PR #${pr.number} ${pr.created ? 'opened' : 'updated'}${pr.committed ? '' : ' (files unchanged)'}`);
      return { state: 'OPEN', number: pr.number };
    } catch (err) {
      if (isInstallationGone(err) && err?.request?.url?.includes('/access_tokens')) {
        await prisma.installation.update({ where: { id: app.installation.id }, data: { suspendedAt: new Date() } });
      }
      const error = prFailureReason(err);
      log.warn(`${app.slug}: couldn't open the setup PR: ${error}`);
      await prisma.app.update({ where: { id: appId }, data: { prState: 'FAILED', prError: error } });
      return { state: 'FAILED', error };
    }
  } finally {
    inFlight.delete(appId);
  }
}

async function pushSetupPr(app, run, release) {
  const [owner, repo] = app.repoFullName.split('/');
  const base = app.defaultBranch;
  const gh = installationClient(app.installation.githubInstallationId);
  const r = { owner, repo };

  // kept files (an existing Dockerfile) stay out of the PR (FR-25)
  const files = run.files.filter((f) => f.origin === 'GENERATED');
  const dockerfileRow = run.files.find((f) => f.kind === 'DOCKERFILE');
  const { facts = {}, assumptions = [] } = dockerfileRow?.facts ?? {};

  // 1. the branch: on top of an existing kairo/setup, else from the default branch
  const { data: baseRef } = await gh.rest.git.getRef({ ...r, ref: `heads/${base}` });
  let branchSha = null;
  try {
    const { data } = await gh.rest.git.getRef({ ...r, ref: `heads/${SETUP_BRANCH}` });
    branchSha = data.object.sha;
  } catch (err) {
    if (err?.status !== 404) throw err;
  }
  const parentSha = branchSha ?? baseRef.object.sha;
  const { data: parent } = await gh.rest.git.getCommit({ ...r, commit_sha: parentSha });

  // 2. one commit with every generated file, only if something changed
  const { data: tree } = await gh.rest.git.createTree({
    ...r,
    base_tree: parent.tree.sha,
    tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  });
  let committed = false;
  if (tree.sha !== parent.tree.sha) {
    const { data: commit } = await gh.rest.git.createCommit({
      ...r,
      message: commitMessage(release.commitSha),
      tree: tree.sha,
      parents: [parentSha],
    });
    if (branchSha) {
      // force: false - a fast-forward only, never a rewrite (FR-33)
      await gh.rest.git.updateRef({ ...r, ref: `heads/${SETUP_BRANCH}`, sha: commit.sha, force: false });
    } else {
      await gh.rest.git.createRef({ ...r, ref: `refs/heads/${SETUP_BRANCH}`, sha: commit.sha });
    }
    committed = true;
  }

  // 3. the PR: update the open one, else open one
  const body = prBody({
    repoFullName: app.repoFullName,
    defaultBranch: base,
    commitSha: release.commitSha,
    image: ghcrImage(app.repoFullName),
    files: run.files,
    facts,
    assumptions,
    graceSeconds: GRACE_MS / 1000,
  });
  const { data: open } = await gh.rest.pulls.list({ ...r, head: `${owner}:${SETUP_BRANCH}`, state: 'open', per_page: 5 });
  if (open.length) {
    await gh.rest.pulls.update({ ...r, pull_number: open[0].number, title: PR_TITLE, body });
    return { number: open[0].number, created: false, committed };
  }
  const { data: pr } = await gh.rest.pulls.create({ ...r, title: PR_TITLE, head: SETUP_BRANCH, base, body });
  return { number: pr.number, created: true, committed };
}

function prFailureReason(err) {
  const msg = githubErrorMessage(err);
  if (err?.status === 403 || err?.status === 404) {
    return `Kairo's GitHub App couldn't write to the repo (${msg}). Check that it has access to this repo and Contents, Pull requests and Workflows permissions.`;
  }
  return `GitHub refused the PR: ${msg}`;
}

// POST /api/apps/:slug/pr (AQ11): Try again. Checks the preview again if it
// wasn't healthy, then opens or updates the PR.
export async function retrySetupPr(userId, slug) {
  const app = await prisma.app.findFirst({
    where: { slug, deletedAt: null, installation: { userId } },
  });
  if (!app) throw new NotFoundError('App');
  if (app.prState === 'MERGED') throw new AppError('The setup PR is already merged', 409);
  if (inGrace(slug)) throw new AppError('The preview is still in its grace window. Wait for it to end.', 409);

  const release = await prisma.release.findFirst({
    where: { appId: app.id, status: 'ACTIVE' },
    orderBy: { deployedAt: 'desc' },
  });
  if (!release) throw new AppError('No running preview to open a PR for. Deploy the repo again.', 409);

  if (release.healthyAt) await openSetupPr(app.id);
  // runs the FR-72 check now; a healthy result opens the PR through the hook
  else await endGrace(release.id);
  return prisma.app.findUnique({ where: { id: app.id }, select: { prState: true, prNumber: true, prError: true } });
}

// FR-34, every 60 s (src/jobs): open, merged or closed. A merged PR is final.
export async function checkPrStates() {
  const apps = await prisma.app.findMany({
    where: {
      deletedAt: null,
      prNumber: { not: null },
      prState: { in: ['OPEN', 'CLOSED'] },
      installation: { suspendedAt: null },
    },
    include: { installation: true },
  });
  for (const app of apps) {
    const [owner, repo] = app.repoFullName.split('/');
    try {
      const { data } = await installationClient(app.installation.githubInstallationId).rest.pulls.get({
        owner,
        repo,
        pull_number: app.prNumber,
      });
      const state = data.merged ? 'MERGED' : data.state === 'closed' ? 'CLOSED' : 'OPEN';
      if (state !== app.prState) {
        await prisma.app.update({ where: { id: app.id }, data: { prState: state } });
        log.info(`${app.slug}: setup PR #${app.prNumber} is now ${state}`);
      }
    } catch (err) {
      log.warn(`${app.slug}: couldn't read PR #${app.prNumber}: ${githubErrorMessage(err)}`);
    }
  }
  return apps.length;
}

// At boot: a healthy preview whose PR never got opened (the backend stopped in
// between) gets it now
export async function resumePendingPrs() {
  const apps = await prisma.app.findMany({
    where: {
      deletedAt: null,
      prState: null,
      installationId: { not: null },
      releases: { some: { status: 'ACTIVE', source: 'PREVIEW', healthyAt: { not: null } } },
    },
    select: { id: true },
  });
  for (const a of apps) await openSetupPr(a.id);
  return apps.length;
}
