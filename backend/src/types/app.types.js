// App health (PRD section 7). HEALING while an action is in flight,
// NEEDS_ATTENTION once Kairo gives up (FR-48, FR-73)
export const APP_HEALTH = Object.freeze(['HEALTHY', 'HEALING', 'NEEDS_ATTENTION']);

// the setup PR's state (FR-34). FAILED: Kairo couldn't open or update it; the
// preview keeps running and the onboarding view offers Try again (AQ11).
// null on an app means Kairo hasn't tried yet
export const PR_STATES = Object.freeze(['OPEN', 'MERGED', 'CLOSED', 'FAILED']);
