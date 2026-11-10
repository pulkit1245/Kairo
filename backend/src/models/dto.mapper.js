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
 * row: an Incident with `app` and `attempts` included
 * @returns {import('../types/incident.types.js').Incident}
 */
export function toIncidentDto(row) {
  return {
    id: row.id,
    appId: row.appId,
    appName: row.app.slug,
    alertName: row.alertName,
    cause: row.cause,
    status: row.status,
    explanation: row.explanation,
    startedAt: row.startedAt.toISOString(),
    resolvedAt: iso(row.resolvedAt),
    recoverySeconds: row.recoverySeconds,
    githubIssueNumber: row.githubIssueNumber,
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
        attemptedAt: a.attemptedAt.toISOString(),
        verifiedAt: iso(a.verifiedAt),
      })),
  };
}

// seconds between start and resolve, one decimal. stored on the incident
export function recoverySeconds(startedAt, resolvedAt) {
  return Math.max(0, Math.round((resolvedAt.getTime() - startedAt.getTime()) / 100) / 10);
}
