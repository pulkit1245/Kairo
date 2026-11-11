// Frontend copy of backend/src/types. Keep it identical: the backend test
// tests/unit/enums.test.js compares this file with src/types and schema.prisma.

export const DEPLOYMENT_STATUSES = Object.freeze([
  'CLONING',
  'DETECTING',
  'GENERATING',
  'BUILDING',
  'DEPLOYING',
  'RUNNING',
  'FAILED',
]);

export const IN_PROGRESS_STATUSES = Object.freeze([
  'CLONING',
  'DETECTING',
  'GENERATING',
  'BUILDING',
  'DEPLOYING',
]);

export const STACKS = Object.freeze(['NODE', 'PYTHON']);

export const APP_HEALTH = Object.freeze(['HEALTHY', 'HEALING', 'NEEDS_ATTENTION']);

// the setup PR (FR-34); null on an app = not tried yet
export const PR_STATES = Object.freeze(['OPEN', 'MERGED', 'CLOSED', 'FAILED']);

export const FILE_KINDS = Object.freeze([
  'DOCKERFILE',
  'DEPLOYMENT',
  'SERVICE',
  'INGRESS',
  'WORKFLOW',
  'ALERT_RULES',
]);

export const FILE_ORIGINS = Object.freeze(['GENERATED', 'KEPT_EXISTING']);

export const RELEASE_SOURCES = Object.freeze(['PREVIEW', 'GHCR', 'TEST']);

export const RELEASE_STATUSES = Object.freeze(['ACTIVE', 'SUPERSEDED', 'ROLLED_BACK', 'FAILED']);

export const REMEDIATION_ACTIONS = Object.freeze([
  'RESTART',
  'ROLLBACK',
  'SCALE_UP',
  'SCALE_DOWN',
  'NONE',
]);

export const ALERT_NAMES = Object.freeze([
  'KairoAppDown',
  'KairoOOMKilled',
  'KairoCrashLoop',
  'KairoHighCpu',
  'KairoHighLatency',
]);

// FR-72: firing inside a grace window keeps the release from being marked healthy
export const HEALTH_BLOCKING_ALERTS = Object.freeze(['KairoOOMKilled', 'KairoCrashLoop']);

export const INCIDENT_STATUSES = Object.freeze(['OPEN', 'RESOLVED']);

export const ATTEMPT_TRIGGERS = Object.freeze(['AUTO', 'MANUAL']);

// SKIPPED, UNVERIFIED and FAILED attempts carry a `reason` saying why (P3)
export const ATTEMPT_RESULTS = Object.freeze([
  'APPLIED',
  'VERIFIED',
  'UNVERIFIED',
  'FAILED',
  'SKIPPED',
]);
