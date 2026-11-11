// db rows -> what the API returns. Dates become ISO strings so the frontend
// doesn't have to guess the format.
// The @returns lines are just so VS Code shows the shape on hover.

import { env } from '../config/env.config.js';
import { FILE_KINDS } from '../types/index.js';
import { cloneUrlFor } from '../utils/repoUrl.js';

const iso = (d) => d?.toISOString() ?? null;

/**
 * row: a PipelineRun with `app` included, and `files` when it's the detail view
 * @returns {import('../types/deployment.types.js').Deployment}
 */
export function toDeploymentDto(row) {
  const dto = {
    id: row.id,
    appId: row.appId,
    repoUrl: cloneUrlFor(row.app.repoFullName),
    repoFullName: row.app.repoFullName,
    // picked from a GitHub App installation (P2) rather than pasted as a URL
    installed: Boolean(row.app.installationId),
    appName: row.app.slug,
    status: row.status,
    failedStep: row.failedStep,
    stack: row.app.stack,
    commitSha: row.commitSha,
    // errorLog = reason on the first line, then the build log tail (pipeline.service.js)
    failureReason: row.errorLog?.split('\n')[0] ?? null,
    logTail: row.errorLog ? row.errorLog.split('\n').slice(1) : [],
    explanation: row.explanation,
    startedAt: row.startedAt.toISOString(),
    finishedAt: iso(row.finishedAt),
    pr: prDto(row.app),
  };

  // only the detail endpoint loads the files and the release
  if (row.files) {
    // facts and assumptions ride on the Dockerfile row (config.service.js)
    const facts = row.files.find((f) => f.kind === 'DOCKERFILE')?.facts ?? {};
    dto.facts = facts.facts ?? {};
    dto.assumptions = facts.assumptions ?? [];
    dto.release = row.release
      ? {
          id: row.release.id,
          status: row.release.status,
          deployedAt: iso(row.release.deployedAt),
          healthyAt: iso(row.release.healthyAt),
          graceEndsAt: iso(new Date(row.release.deployedAt.getTime() + row.release.graceMs)),
        }
      : null;
  }
  if (row.files) {
    dto.configs = [...row.files]
      .sort((a, b) => FILE_KINDS.indexOf(a.kind) - FILE_KINDS.indexOf(b.kind))
      .map((f) => ({ kind: f.kind, origin: f.origin, path: f.path, content: f.content }));
  }
  return dto;
}

// the setup PR (FR-34); state null = Kairo hasn't tried yet
function prDto(app) {
  return {
    state: app.prState ?? null,
    number: app.prNumber ?? null,
    url: app.prNumber ? `https://github.com/${app.repoFullName}/pull/${app.prNumber}` : null,
    error: app.prError ?? null,
    // GitHub names the bot after the App (kairo-devops[bot], not kairo[bot])
    bot: env.github.appSlug ? `${env.github.appSlug}[bot]` : null,
  };
}

/**
 * The app page header and release list (P2c, Stitch 07).
 * row: an App with `releases` (newest first) and `pipelineRuns` (the latest)
 * extra: { graceMs, storedImages: Set of image refs still on the laptop (FR-38),
 *          attentionReason, traffic: Send Traffic's current or last run,
 *          incidents: Incident DTOs }
 */
export function toAppDto(
  row,
  { graceMs, storedImages, attentionReason = null, traffic = null, incidents = [], tunnel = null, rollbackBlocked = () => 'not offered' },
) {
  const run = row.pipelineRuns?.[0] ?? null;
  const release = (r) => ({
    id: r.id,
    commitSha: r.commitSha,
    commitMessage: r.commitMessage,
    imageRef: r.imageRef,
    source: r.source,
    status: r.status,
    deployedAt: iso(r.deployedAt),
    healthyAt: iso(r.healthyAt),
    graceEndsAt: iso(new Date(r.deployedAt.getTime() + graceMs)),
    // FR-38: pruned images can't be rolled back to (FR-50)
    imageStored: storedImages.has(r.imageRef),
    // FR-61: "Roll back to this" is offered on earlier healthy releases whose
    // image is stored; null when it can run now, else why not (e.g. a grace window)
    rollbackBlockedBy: rollbackBlocked(r),
  });
  const active = row.releases.find((r) => r.status === 'ACTIVE');
  return {
    id: row.id,
    slug: row.slug,
    repoFullName: row.repoFullName,
    repoUrl: `https://github.com/${row.repoFullName}`,
    defaultBranch: row.defaultBranch,
    installed: Boolean(row.installationId),
    stack: row.stack,
    health: row.health,
    // why it NEEDS_ATTENTION (null otherwise, or after a backend restart)
    attentionReason,
    autoHeal: row.autoHeal,
    replicas: row.replicas,
    publicUrl: row.publicUrl,
    // FR-40: 'starting' | 'up' | 'restarting', null without a tunnel
    tunnel,
    pipeline: run
      ? { id: run.id, status: run.status, failedStep: run.failedStep, startedAt: iso(run.startedAt), finishedAt: iso(run.finishedAt) }
      : null,
    release: active ? release(active) : null,
    releases: row.releases.map(release),
    pr: prDto(row),
    // FR-35: Kairo rolls out new GHCR images once the setup PR is merged
    watchingGhcr: row.prState === 'MERGED',
    traffic,
    // the app's latest incidents, newest first (P3b), as GET /api/incidents
    incidents,
  };
}

/**
 * One card on the Apps list (Stitch 06).
 * row: an App with `releases` (the ACTIVE one), `pipelineRuns` (the latest)
 *      and `incidents` (the latest)
 * extra: { attentionReason, tunnel, now: appSnapshot() or null }
 */
export function toAppSummaryDto(row, { attentionReason = null, tunnel = null, now = null }) {
  const run = row.pipelineRuns?.[0] ?? null;
  const active = row.releases?.[0] ?? null;
  const incident = row.incidents?.[0] ?? null;
  return {
    id: row.id,
    slug: row.slug,
    repoFullName: row.repoFullName,
    stack: row.stack,
    health: row.health,
    attentionReason,
    autoHeal: row.autoHeal,
    replicas: row.replicas,
    publicUrl: row.publicUrl,
    tunnel,
    pipeline: run
      ? { id: run.id, status: run.status, failedStep: run.failedStep, startedAt: iso(run.startedAt), finishedAt: iso(run.finishedAt) }
      : null,
    release: active
      ? { id: active.id, commitSha: active.commitSha, commitMessage: active.commitMessage, source: active.source, deployedAt: iso(active.deployedAt) }
      : null,
    lastIncident: incident
      ? {
          id: incident.id,
          alertName: incident.alertName,
          cause: incident.cause,
          status: incident.status,
          startedAt: iso(incident.startedAt),
          recoverySeconds: incident.recoverySeconds,
        }
      : null,
    now,
  };
}

/**
 * row: an Incident with `app` and `attempts` included
 * @returns {import('../types/incident.types.js').Incident}
 */
export function toIncidentDto(row) {
  return {
    id: row.id,
    appId: row.appId,
    appName: row.app.slug,
    alertName: row.alertName,
    pod: row.pod ?? null,
    cause: row.cause,
    status: row.status,
    explanation: row.explanation,
    startedAt: row.startedAt.toISOString(),
    resolvedAt: iso(row.resolvedAt),
    recoverySeconds: row.recoverySeconds,
    githubIssueNumber: row.githubIssueNumber,
    // FR-55: the app's Kairo issue this incident opened or commented on
    githubIssueUrl: row.githubIssueNumber && row.app.repoFullName ? `https://github.com/${row.app.repoFullName}/issues/${row.githubIssueNumber}` : null,
    attempts: [...(row.attempts ?? [])]
      .sort((a, b) => a.attemptedAt - b.attemptedAt)
      .map((a) => ({
        id: a.id,
        action: a.action,
        trigger: a.trigger,
        dryRun: a.dryRun,
        result: a.result,
        fromReleaseId: a.fromReleaseId,
        toReleaseId: a.toReleaseId,
        // the releases' commits and sources, for "rolled back from … to …" (P3).
        // Break It's TEST release reuses the commit it replaced
        fromSha: a.fromRelease?.commitSha ?? null,
        fromSource: a.fromRelease?.source ?? null,
        toSha: a.toRelease?.commitSha ?? null,
        toSource: a.toRelease?.source ?? null,
        attemptedAt: a.attemptedAt.toISOString(),
        verifiedAt: iso(a.verifiedAt),
        // why it was SKIPPED, UNVERIFIED or FAILED (P3)
        reason: a.reason ?? null,
      })),
  };
}

// seconds between start and resolve, one decimal. stored on the incident
export function recoverySeconds(startedAt, resolvedAt) {
  return Math.max(0, Math.round((resolvedAt.getTime() - startedAt.getTime()) / 100) / 10);
}
