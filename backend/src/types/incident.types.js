export const REMEDIATION_ACTIONS = Object.freeze([
  'RESTART',
  'ROLLBACK',
  'SCALE_UP',
  'SCALE_DOWN',
  'NONE',
]);

export const INCIDENT_STATUSES = Object.freeze(['OPEN', 'RESOLVED']);

export const ATTEMPT_TRIGGERS = Object.freeze(['AUTO', 'MANUAL']);

// APPLIED    the action ran, not checked yet
// VERIFIED   the check afterwards passed (FR-73, P3)
// UNVERIFIED the check timed out, app goes to NEEDS_ATTENTION
// FAILED     the action itself errored
// SKIPPED    nothing was done: dry run, no action for this alert, or not built yet
export const ATTEMPT_RESULTS = Object.freeze([
  'APPLIED',
  'VERIFIED',
  'UNVERIFIED',
  'FAILED',
  'SKIPPED',
]);

/**
 * One action Kairo took for an incident.
 * @typedef {object} RemediationAttempt
 * @property {string} id
 * @property {string} action                one of REMEDIATION_ACTIONS
 * @property {string} trigger               one of ATTEMPT_TRIGGERS
 * @property {boolean} dryRun
 * @property {string} result                one of ATTEMPT_RESULTS
 * @property {string | null} fromReleaseId
 * @property {string | null} toReleaseId
 * @property {string} attemptedAt           ISO date
 * @property {string | null} verifiedAt     ISO date
 */

/**
 * What GET /api/incidents returns (a list of these).
 * @typedef {object} Incident
 * @property {string} id
 * @property {string} appId
 * @property {string} appName                the App's slug
 * @property {string} alertName
 * @property {string} cause
 * @property {string} status                 one of INCIDENT_STATUSES
 * @property {string | null} explanation     Gemini, P4
 * @property {string} startedAt              ISO date
 * @property {string | null} resolvedAt      ISO date
 * @property {number | null} recoverySeconds null while still open
 * @property {number | null} githubIssueNumber
 * @property {RemediationAttempt[]} attempts oldest first
 */
