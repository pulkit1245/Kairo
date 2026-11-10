// One kind per generated file (PRD section 7)
export const FILE_KINDS = Object.freeze([
  'DOCKERFILE',
  'DEPLOYMENT',
  'SERVICE',
  'INGRESS',
  'WORKFLOW',
  'ALERT_RULES',
]);

// KEPT_EXISTING = the repo already had this file and Kairo left it alone (FR-25, P2)
export const FILE_ORIGINS = Object.freeze(['GENERATED', 'KEPT_EXISTING']);
