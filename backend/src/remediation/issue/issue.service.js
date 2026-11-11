import { githubConfigured } from '../../config/env.config.js';
import { prisma } from '../../db/index.js';
import * as github from '../../github/github.client.js';
import { MANUAL_ROLLBACK } from '../../types/incident.types.js';
import { createLogger } from '../../utils/logger.js';
import * as state from '../healing/healing.state.js';

const log = createLogger('issues');

// FR-55: Kairo opens a GitHub issue (label `kairo`) on every rollback and every
// NEEDS_ATTENTION, not on restarts. Each app has at most one open Kairo issue;
// later incidents add comments to it.
//
// Two ways in, both after the incident is recorded (act first, record second,
// FR-74), never awaited by healing:
//   - reportIncident(id): a new incident. An open issue gets a comment; with
//     none, one opens if the incident rolled back or the app needs attention.
//   - reportAttention(attemptId, reason): an action's check ended in
//     NEEDS_ATTENTION (verify.service.js). Same, with the reason.
// Work for one app runs one at a time, so two incidents can't open two issues.
// Apps added from a pasted URL have no installation, so no issue: logged.

let gh = github;
let db = prisma;

const queues = new Map();
function enqueue(slug, job) {
  const next = (queues.get(slug) ?? Promise.resolve()).then(job).catch((err) => {
    log.warn(`${slug}: ${github.githubErrorMessage(err)}`);
    return 'failed';
  });
  queues.set(slug, next);
  next.finally(() => {
    if (queues.get(slug) === next) queues.delete(slug);
  });
  return next;
}

/** @returns {Promise<'opened'|'commented'|'none'|'skipped'|'failed'>} */
export async function reportIncident(incidentId) {
  const incident = await load(incidentId).catch(() => null);
  if (!incident) return 'skipped';
  return enqueue(incident.app.slug, () => report(incidentId, null));
}

export async function reportAttention(attemptId, reason) {
  const attempt = await db.remediationAttempt.findUnique({ where: { id: attemptId }, select: { incidentId: true } }).catch(() => null);
  if (!attempt) return 'skipped';
  const incident = await load(attempt.incidentId).catch(() => null);
  if (!incident) return 'skipped';
  return enqueue(incident.app.slug, () => report(attempt.incidentId, reason ?? 'Kairo stopped acting on it'));
}

const load = (id) =>
  db.incident.findUnique({
    where: { id },
    include: {
      app: { include: { installation: true } },
      attempts: {
        orderBy: { attemptedAt: 'asc' },
        include: { fromRelease: { select: { commitSha: true, source: true } }, toRelease: { select: { commitSha: true } } },
      },
    },
  });

async function report(incidentId, attention) {
  // read again inside the queue: the explanation or a check may have landed
  const incident = await load(incidentId);
  if (!incident || incident.app.deletedAt) return 'skipped';
  const { app } = incident;
  if (!app.installation || !githubConfigured()) {
    log.info(`${app.slug}: added without the GitHub App, so no issue for ${incident.alertName}`);
    return 'skipped';
  }
  const [owner, repo] = app.repoFullName.split('/');
  const installation = app.installation.githubInstallationId;
  const needsAttention = attention !== null || state.getHealth(app.slug) === 'NEEDS_ATTENTION';
  const rolledBack = incident.attempts.some((a) => a.action === 'ROLLBACK' && a.result !== 'SKIPPED' && a.result !== 'FAILED');

  const open = await gh.findOpenKairoIssue(installation, owner, repo);
  if (open) {
    await gh.commentOnIssue(installation, owner, repo, open.number, issueText(incident, attention, needsAttention));
    await saveNumber(incident, open.number);
    log.info(`${app.slug}: commented on issue #${open.number} (${incident.alertName}${attention ? ', needs attention' : ''})`);
    return 'commented';
  }
  if (!rolledBack && !needsAttention) return 'none'; // a restart or a scale-up: dashboard only
  const issue = await gh.openKairoIssue(installation, owner, repo, {
    title: issueTitle(app.slug, rolledBack, needsAttention),
    body: `${issueText(incident, attention, needsAttention)}\n\n${FOOTER}`,
  });
  await saveNumber(incident, issue.number);
  log.info(`${app.slug}: opened issue #${issue.number}`);
  return 'opened';
}

async function saveNumber(incident, number) {
  if (incident.githubIssueNumber === number) return;
  await db.incident.update({ where: { id: incident.id }, data: { githubIssueNumber: number } }).catch((err) => {
    log.warn(`could not save issue #${number} on the incident: ${err.message}`);
  });
}

// ---------- the text ----------

const FOOTER =
  'Kairo adds a comment here for every later incident on this app. Close this issue once the cause is fixed; the next rollback or stop opens a new one.\n\n<sub>Opened by Kairo, the zero-touch DevOps platform for this repo.</sub>';

export function issueTitle(slug, rolledBack, needsAttention) {
  if (needsAttention) return `Kairo stopped acting on ${slug}`;
  return rolledBack ? `Kairo rolled back ${slug}` : `Kairo: incident on ${slug}`;
}

const short = (sha) => (sha ? `\`${sha.slice(0, 7)}\`` : null);

const RESULT = {
  APPLIED: 'done, being checked (90 s)',
  VERIFIED: 'verified',
  UNVERIFIED: 'not confirmed within 90 s',
  FAILED: 'failed',
  SKIPPED: 'not done',
};

export function attemptLine(a) {
  let what;
  switch (a.action) {
    case 'ROLLBACK': {
      const from = a.fromRelease?.source === 'TEST' ? 'the Break It release' : short(a.fromRelease?.commitSha);
      const to = short(a.toRelease?.commitSha);
      what = `Rolled back${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}`;
      break;
    }
    case 'RESTART':
      what = 'Restarted the pod';
      break;
    case 'SCALE_UP':
      what = 'Added a replica';
      break;
    case 'SCALE_DOWN':
      what = 'Removed a replica';
      break;
    default:
      what = 'No action';
  }
  const who = a.trigger === 'MANUAL' ? ' (by hand, from the release list)' : '';
  const why = a.reason ? `: ${a.reason}` : '';
  return `- ${what}${who}, ${RESULT[a.result] ?? a.result.toLowerCase()}${why}`;
}

// the body of a new issue, or a comment
export function issueText(incident, attention, needsAttention) {
  const when = incident.startedAt.toISOString().replace('T', ' ').slice(0, 16);
  const manual = incident.alertName === MANUAL_ROLLBACK;
  const lines = [
    manual
      ? `**Manual rollback** (${when} UTC): ${incident.cause}.`
      : `**${incident.alertName}** (${when} UTC): ${incident.cause}.`,
  ];
  if (incident.explanation) lines.push('', `**What went wrong, explained by Gemini:** ${incident.explanation}`);
  if (incident.attempts.length) lines.push('', '**What Kairo did:**', ...incident.attempts.map(attemptLine));
  if (attention) lines.push('', `**Kairo stopped acting on the app:** ${attention}. It needs a look.`);
  else if (needsAttention && !manual) lines.push('', '**The app needs attention:** Kairo is not acting on it until it clears.');
  return lines.join('\n');
}

// tests
export function _setDeps({ github: g = github, db: d = prisma } = {}) {
  gh = g;
  db = d;
}
export const _drain = () => Promise.all(queues.values());
