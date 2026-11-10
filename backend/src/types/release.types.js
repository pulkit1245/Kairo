// PREVIEW = built on the laptop during onboarding, GHCR = built by the repo's own CI,
// TEST = Break It's release that exits on start (FR-63, P3)
export const RELEASE_SOURCES = Object.freeze(['PREVIEW', 'GHCR', 'TEST']);

export const RELEASE_STATUSES = Object.freeze(['ACTIVE', 'SUPERSEDED', 'ROLLED_BACK', 'FAILED']);
