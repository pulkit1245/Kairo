import { env } from '../../config/env.config.js';
import { prisma } from '../../db/index.js';
import { startGrace } from '../../shipping/grace.service.js';
import { isRolloutInProgress } from '../../state/rollout.state.js';
import { errorMessage } from '../../utils/AppError.js';
import { createLogger } from '../../utils/logger.js';
import { executeAction } from '../action/executor.service.js';
import * as state from './healing.state.js';
import { setAppHealth } from './health.service.js';
import { verifyAction } from './verify.service.js';

const log = createLogger('remediation');

// The one gate every automatic action goes through, in this order:
//
// Every SKIPPED or FAILED attempt carries its reason (the note), for the
// drawer; verify.service.js adds one to UNVERIFIED attempts.
//
//   1. no action for the alert                      -> SKIPPED
//   2. the app NEEDS_ATTENTION                      -> SKIPPED, Kairo stopped acting (FR-48, FR-73)
//   3. auto-heal off                                -> SKIPPED, NEEDS_ATTENTION (FR-51, AQ9)
//   4. mid-rollout, or another action running or being checked -> SKIPPED
//      (a rollback may take over: see claimAction())
//   5. 3 attempts in the last 10 minutes            -> SKIPPED, NEEDS_ATTENTION (FR-48)
//   6. act (executor.service.js), then HEALING and the 90 s check (FR-73)
//
// A MANUAL rollback (FR-61, from the release list) is a person's decision: it
// skips 2, 3 and 5 and doesn't count toward give-up, but otherwise takes the
// same path: the grace window, HEALING and the 90 s check. A verified one
// ends NEEDS_ATTENTION. rollback.service.js checks the rest before calling.
//
// Returns the attempt to record and followUp(attemptId), which records the
// release changes of a rollback and runs the verification. Call followUp right
// away with a promise of the attempt's id: act first, record second (FR-74).

const NOT_COUNTED = new Set(['SCALE_DOWN', 'NONE']); // decision 6

/**
 * @param {{ id: string, slug: string, namespace: string }} app
 * @param {string} action
 * @param {{ pod?: string | null, toReleaseId?: string }} ctx  toReleaseId: a manual rollback's target
 * @param {string} [trigger]
 */
export async function heal(app, action, ctx, trigger = 'AUTO') {
  const attemptedAt = new Date();
  const skip = (note, health) => {
    if (health) setAppHealth(app.slug, 'NEEDS_ATTENTION', health);
    return done(app, { action, trigger, dryRun: env.remediationDryRun, result: 'SKIPPED', attemptedAt, reason: note }, note);
  };

  const manual = trigger === 'MANUAL';
  if (action === 'NONE') return skip('no action for this alert');
  if (!manual && state.getHealth(app.slug) === 'NEEDS_ATTENTION') return skip('the app needs attention: Kairo stopped acting on it');
  if (!manual && !state.isAutoHeal(app.slug)) return skip('auto-heal is off', 'an alert fired with auto-heal off');
  if (isRolloutInProgress(app.slug)) return skip('a rollout is in progress');
  if (!manual && !NOT_COUNTED.has(action) && state.recentAttempts(app.slug) >= state.GIVE_UP_ATTEMPTS) {
    log.warn(`${app.slug}: ${state.GIVE_UP_ATTEMPTS} attempts in 10 minutes, giving up`);
    return skip(`gave up: ${state.GIVE_UP_ATTEMPTS} attempts in 10 minutes`, `${state.GIVE_UP_ATTEMPTS} attempts in 10 minutes didn't fix it`);
  }
  // claimed before the first await, so a second alert can't slip in
  const token = state.claimAction(app.slug, action);
  if (token === null) return skip('another action is still being verified');

  // act
  let outcome;
  try {
    outcome = await executeAction(action, {
      appId: app.id,
      slug: app.slug,
      namespace: app.namespace,
      pod: ctx.pod ?? null,
      toReleaseId: ctx.toReleaseId ?? null,
    });
  } catch (err) {
    state.releaseAction(app.slug, token);
    throw err;
  }
  const ran = outcome.action ?? action;
  const attempt = {
    action: ran,
    trigger,
    dryRun: outcome.dryRun,
    result: outcome.result,
    attemptedAt,
    fromReleaseId: outcome.rollback?.from?.id ?? null,
    toReleaseId: outcome.rollback?.to?.id ?? null,
    // why it didn't run (e.g. "already at 3 replicas, the cap") or failed
    reason: outcome.result === 'SKIPPED' || outcome.result === 'FAILED' ? (outcome.note ?? null) : null,
  };
  if (outcome.result !== 'APPLIED') state.releaseAction(app.slug, token);
  if (outcome.result === 'SKIPPED') return done(app, attempt, outcome.note);
  if (!manual && !NOT_COUNTED.has(ran)) state.countAttempt(app.slug, attemptedAt.getTime());
  if (outcome.result === 'FAILED') return done(app, attempt, outcome.note);
  // a person picked the release: the give-up count starts again (FR-49)
  if (manual) state.clearAttempts(app.slug);

  setAppHealth(app.slug, 'HEALING');
  // FR-71: a rollback is a rollout too. The window starts now, so the watcher
  // leaves the app alone and new alerts wait for it to end
  if (outcome.rollback) startGrace(outcome.rollback.to, app, Date.now(), new Date());

  const followUp = (attemptId) => {
    if (outcome.rollback) recordRollback(app, outcome.rollback).catch(() => {});
    if (outcome.replicas) {
      prisma.app.update({ where: { id: app.id }, data: { replicas: outcome.replicas } }).catch((err) => {
        log.warn(`could not save ${app.slug}'s replica count: ${errorMessage(err)}`);
      });
    }
    return verifyAction({
      slug: app.slug,
      namespace: app.namespace,
      action: ran,
      expect: outcome.expect,
      attemptId,
      attentionAfter: outcome.attentionAfter,
      startedAt: attemptedAt.getTime(),
      token,
    }).catch((err) => log.error(`checking ${app.slug}'s ${ran} failed`, err));
  };
  return { attempt, note: outcome.note, followUp };
}

const done = (app, attempt, note) => ({ attempt, note, followUp: () => Promise.resolve(null) });

// the release changes of a rollback, after the act: the release rolled away
// from is ROLLED_BACK, the target ACTIVE again (architecture 5.3)
async function recordRollback(app, { from, to }) {
  const write = () =>
    prisma.$transaction([
      ...(from ? [prisma.release.update({ where: { id: from.id }, data: { status: 'ROLLED_BACK' } })] : []),
      prisma.release.updateMany({ where: { appId: app.id, status: 'ACTIVE', id: { not: to.id } }, data: { status: 'SUPERSEDED' } }),
      prisma.release.update({ where: { id: to.id }, data: { status: 'ACTIVE' } }),
    ]);
  try {
    await write();
  } catch (first) {
    log.warn(`could not record ${app.slug}'s rollback: ${errorMessage(first)}. Retrying once`);
    await new Promise((r) => setTimeout(r, 1000));
    await write().catch((err) => log.error(`could not record ${app.slug}'s rollback: ${errorMessage(err)}`));
  }
}
