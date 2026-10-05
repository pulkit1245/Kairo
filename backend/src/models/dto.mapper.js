// db rows -> what the API returns. Dates become ISO strings so the frontend
// doesn't have to guess the format.
// The @returns lines are just so VS Code shows the shape on hover.

/** @returns {import('../types/deployment.types.js').Deployment} */
export function toDeploymentDto(row) {
  return {
    id: row.id,
    repoUrl: row.repoUrl,
    appName: row.appName,
    status: row.status,
    stack: row.stack,
    commitSha: row.commitSha,
    failureReason: row.failureReason,
    configs: row.configs ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** @returns {import('../types/incident.types.js').Incident} */
export function toIncidentDto(row) {
  const recoverySeconds = row.resolvedAt
    ? Math.round((row.resolvedAt.getTime() - row.startedAt.getTime()) / 100) / 10
    : null;

  return {
    id: row.id,
    deploymentId: row.deploymentId,
    appName: row.appName,
    alertName: row.alertName,
    cause: row.cause,
    action: row.action,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    recoverySeconds,
  };
}
