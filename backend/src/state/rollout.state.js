// Which apps are mid-rollout right now (FR-74: rollout locks live in memory).
// The pipeline sets it from DEPLOYING until the run ends; remediation reads it
// and doesn't act on an app while it is being rolled out, because the pods are
// supposed to be changing then.
//
// This is the one in-memory state generator/ and remediation/ share. It imports
// nothing, like src/types, so the two packages still never import each other.

const rolling = new Map(); // slug -> start time

export function beginRollout(slug) {
  rolling.set(slug, Date.now());
}

export function endRollout(slug) {
  rolling.delete(slug);
}

export function isRolloutInProgress(slug) {
  return rolling.has(slug);
}
