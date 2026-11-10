// App health (PRD section 7). HEALING while an action is in flight,
// NEEDS_ATTENTION once Kairo gives up (FR-48, FR-73)
export const APP_HEALTH = Object.freeze(['HEALTHY', 'HEALING', 'NEEDS_ATTENTION']);
