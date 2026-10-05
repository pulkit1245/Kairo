export const REMEDIATION_ACTIONS = Object.freeze(['RESTART', 'ROLLBACK', 'SCALE', 'NONE']);

export const INCIDENT_STATUSES = Object.freeze(['OPEN', 'RESOLVED']);

/**
 * What GET /api/incidents returns (a list of these).
 * @typedef {object} Incident
 * @property {string} id
 * @property {string | null} deploymentId
 * @property {string} appName
 * @property {string} alertName
 * @property {string} cause
 * @property {string} action               one of REMEDIATION_ACTIONS
 * @property {string} status               one of INCIDENT_STATUSES
 * @property {string} startedAt            ISO date
 * @property {string | null} resolvedAt    ISO date
 * @property {number | null} recoverySeconds  null while still open. this is the number the demo is about
 */
