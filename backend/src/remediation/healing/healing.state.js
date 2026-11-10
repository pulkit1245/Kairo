import { prisma } from '../../db/index.js';

// What healing decides from (FR-74): each app's health and auto-heal switch,
// its recent automatic attempts (give-up, FR-48) and whether an action is
// being verified (FR-73). All in memory, rebuilt from the database at boot.
//
//   health:   slug -> { health: HEALTHY | HEALING | NEEDS_ATTENTION, reason, since }
//   autoHeal: slug -> boolean
//   recent:   slug -> [attempt times], automatic attempts that count for give-up
//   verifying: slugs with an action still being checked

export const GIVE_UP_ATTEMPTS = 3; // FR-48
export const GIVE_UP_WINDOW_MS = 10 * 60 * 1000;

const health = new Map();
const autoHeal = new Map();
const recent = new Map();
const verifying = new Set();

export const getHealth = (slug) => health.get(slug)?.health ?? 'HEALTHY';
export const attentionReason = (slug) => health.get(slug)?.reason ?? null;

export function setHealthState(slug, value, reason = null, now = Date.now()) {
  const before = health.get(slug);
  // since: when it started needing attention, kept while it stays there
  const since = value === 'NEEDS_ATTENTION' ? (before?.health === 'NEEDS_ATTENTION' ? before.since : now) : null;
  const keptReason = value === 'NEEDS_ATTENTION' ? (before?.health === 'NEEDS_ATTENTION' && !reason ? before.reason : reason) : null;
  health.set(slug, { health: value, reason: keptReason, since });
}

export const attentionSince = (slug) => health.get(slug)?.since ?? null;
export const slugsNeedingAttention = () =>
  [...health.entries()].filter(([, h]) => h.health === 'NEEDS_ATTENTION').map(([slug]) => slug);

export const isAutoHeal = (slug) => autoHeal.get(slug) ?? true;
export const setAutoHealState = (slug, on) => autoHeal.set(slug, on);

// attempts in the last 10 minutes
export function recentAttempts(slug, now = Date.now()) {
  const kept = (recent.get(slug) ?? []).filter((t) => now - t < GIVE_UP_WINDOW_MS);
  recent.set(slug, kept);
  return kept.length;
}

export function countAttempt(slug, at = Date.now()) {
  recent.set(slug, [...(recent.get(slug) ?? []), at]);
}

// a cleared NEEDS_ATTENTION starts the count again
export const clearAttempts = (slug) => recent.delete(slug);

export const isVerifying = (slug) => verifying.has(slug);
export const beginVerifying = (slug) => verifying.add(slug);
export const endVerifying = (slug) => verifying.delete(slug);

// Attempts that count toward give-up: automatic, an action that ran (not
// SKIPPED), and not a scale-down (decision 6)
export const COUNTED = {
  trigger: 'AUTO',
  result: { not: 'SKIPPED' },
  action: { notIn: ['SCALE_DOWN', 'NONE'] },
};

export async function rebuild(now = Date.now()) {
  health.clear();
  autoHeal.clear();
  recent.clear();
  verifying.clear();
  const [apps, attempts] = await Promise.all([
    prisma.app.findMany({ where: { deletedAt: null }, select: { slug: true, health: true, autoHeal: true } }),
    prisma.remediationAttempt.findMany({
      where: { ...COUNTED, attemptedAt: { gte: new Date(now - GIVE_UP_WINDOW_MS) } },
      select: { attemptedAt: true, incident: { select: { app: { select: { slug: true } } } } },
    }),
  ]);
  for (const a of apps) {
    // after a restart the reason is gone; the incidents still show it
    setHealthState(a.slug, a.health, a.health === 'NEEDS_ATTENTION' ? 'set before the backend restarted' : null);
    setAutoHealState(a.slug, a.autoHeal);
  }
  for (const a of attempts) countAttempt(a.incident.app.slug, a.attemptedAt.getTime());
  return { apps: apps.length, recentAttempts: attempts.length };
}

// for tests
export function _reset() {
  health.clear();
  autoHeal.clear();
  recent.clear();
  verifying.clear();
}
