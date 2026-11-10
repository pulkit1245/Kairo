// db rows -> what the API returns. Dates become ISO strings so the frontend
// doesn't have to guess the format.
// The @returns lines are just so VS Code shows the shape on hover.

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
  };

  // only the detail endpoint loads the files
  if (row.files) {
    dto.configs = [...row.files]
      .sort((a, b) => FILE_KINDS.indexOf(a.kind) - FILE_KINDS.indexOf(b.kind))
      .map((f) => ({ kind: f.kind, origin: f.origin, path: f.path, content: f.content }));
  }
  return dto;
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
