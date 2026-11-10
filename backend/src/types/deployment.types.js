// Shared contract between generator/, remediation/ and the frontend.
// Every list here is also a Prisma enum and is copied to frontend/src/types/enums.js.
// Change all three in one commit; tests/unit/enums.test.js fails if they drift.

// pipeline steps in order. FAILED can happen at any step (FR-7)
export const DEPLOYMENT_STATUSES = Object.freeze([
  'CLONING',
  'DETECTING',
  'GENERATING',
  'BUILDING',
  'DEPLOYING',
  'RUNNING',
  'FAILED',
]);

// not a final state. the frontend shows a spinner for these
export const IN_PROGRESS_STATUSES = Object.freeze([
  'CLONING',
  'DETECTING',
  'GENERATING',
  'BUILDING',
  'DEPLOYING',
]);

export const STACKS = Object.freeze(['NODE', 'PYTHON']);

/**
 * One generated file, as the API returns it.
 * @typedef {object} GeneratedConfig
 * @property {string} kind      one of FILE_KINDS
 * @property {string} origin    one of FILE_ORIGINS
 * @property {string} path      where it sits inside the user's repo
 * @property {string} content
 */

/**
 * What /api/deployments returns. A "deployment" is one PipelineRun plus a few
 * fields from its App, so the URLs from phase 1 keep working.
 * @typedef {object} Deployment
 * @property {string} id                  the PipelineRun id
 * @property {string} appId
 * @property {string} repoUrl             https://github.com/owner/repo.git
 * @property {string} repoFullName        owner/repo
 * @property {boolean} installed          onboarded through the GitHub App (repo picker), not the URL shortcut
 * @property {string} appName             the App's slug
 * @property {string} status              one of DEPLOYMENT_STATUSES
 * @property {string | null} failedStep   the step it was on when it failed
 * @property {string | null} stack        one of STACKS
 * @property {string | null} commitSha
 * @property {string | null} failureReason  readable reason, one line
 * @property {string[]} logTail           last build log lines when BUILDING failed, else []
 * @property {string | null} explanation  Gemini, P4
 * @property {string} startedAt           ISO date
 * @property {string | null} finishedAt   ISO date, null while running
 * @property {GeneratedConfig[]} [configs] only on GET /api/deployments/:id
 */
