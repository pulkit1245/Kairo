// Shared contract between generator/, remediation/ and the frontend.
// The frontend keeps its own copy of these, so if you change something here tell FE 1/FE 2.

export const DEPLOYMENT_STATUSES = Object.freeze([
  'CLONING',
  'DETECTING',
  'GENERATING',
  'BUILDING',
  'DEPLOYING',
  'RUNNING',
  'FAILED',
]);

// everything that isn't a final state. used to clean up after a crash
export const IN_PROGRESS_STATUSES = Object.freeze([
  'CLONING',
  'DETECTING',
  'GENERATING',
  'BUILDING',
  'DEPLOYING',
]);

export const STACKS = Object.freeze(['NODE', 'PYTHON']);

/**
 * One generated file. `path` is where it would sit inside the user's repo.
 * @typedef {object} GeneratedConfig
 * @property {'dockerfile' | 'k8s' | 'ci' | 'prometheus'} kind
 * @property {string} path
 * @property {string} content
 */

/**
 * What GET /api/deployments/:id returns.
 * @typedef {object} Deployment
 * @property {string} id
 * @property {string} repoUrl
 * @property {string} appName
 * @property {string} status          one of DEPLOYMENT_STATUSES
 * @property {string | null} stack    one of STACKS
 * @property {string | null} commitSha
 * @property {string | null} failureReason
 * @property {GeneratedConfig[]} configs
 * @property {string} createdAt       ISO date
 * @property {string} updatedAt       ISO date
 */
