import { prisma } from '../../db/index.js';
import { actionTookEffect, k8sErrorMessage } from '../../kubernetes/k8s.client.js';
import { errorMessage } from '../../utils/AppError.js';
import { createLogger } from '../../utils/logger.js';
import { reportAttention } from '../issue/issue.service.js';
import * as state from './healing.state.js';
import { setAppHealth } from './health.service.js';

const log = createLogger('verify');

// FR-73: after every action, Kairo checks through the Kubernetes API that it
// took effect: every desired replica runs the intended release and is ready,
// within 90 s. VERIFIED -> the app is HEALTHY again. UNVERIFIED -> the app
// NEEDS_ATTENTION and Kairo stops acting on it.
//
// The check starts right after the action, before anything is written
// (FR-74). The attempt row is updated when its id is known.
//
// With the database down the attempt has no row yet: it waits in memory with
// its incident (incident.state.js) and is saved later, as the object it is.
// A check that ends before then writes its result onto that object, so the
// later save carries it, and keeps it here; a save that happens while the
// check still runs, or while the result is being written, reports the row's
// id through attemptSaved(), which writes the result then (P5f).
const lateResults = new WeakMap(); // attempt object -> the result its row still needs
const savedIds = new WeakMap(); // attempt object -> its row id, once saved

/**
 * The incident service saved a queued attempt (or its incident with it): its
 * row id is known now. If a check already ended for it, the row gets the
 * result. Never throws.
 */
export async function attemptSaved(attempt, id, db = prisma) {
  if (!attempt || !id) return;
  savedIds.set(attempt, id);
  const data = lateResults.get(attempt);
  if (!data) return;
  lateResults.delete(attempt);
  await db.remediationAttempt.update({ where: { id }, data }).catch((err) => {
    log.warn(`could not save a late verification: ${errorMessage(err)}`);
  });
}

export const VERIFY_MS = 90_000; // FR-73, proposed
export const POLL_MS = 3000;

/**
 * @param {object} p
 * @param {string} p.slug
 * @param {string} p.namespace
 * @param {string} p.action
 * @param {object} p.expect           see actionTookEffect()
 * @param {Promise<string|null>|string|null} p.attemptId
 * @param {object} [p.attempt]       the attempt as heal() made it, for when it has no row yet
 * @param {string} [p.attentionAfter] verified or not, the app needs attention after (FR-50)
 * @param {number} [p.startedAt]
 * @param {number} [p.token]          heal()'s claim on the app
 * @returns {Promise<{ result: 'VERIFIED' | 'UNVERIFIED', detail?: string }>}
 */
const DEFAULT_DEPS = { check: actionTookEffect, db: prisma, pollMs: POLL_MS, verifyMs: VERIFY_MS, onAttention: reportAttention };

export async function verifyAction(p, deps = DEFAULT_DEPS) {
  const { slug, namespace, action, expect, attemptId, attentionAfter } = p;
  const deadline = (p.startedAt ?? Date.now()) + deps.verifyMs;
  // heal() claimed the app before acting; a resumed check claims it here
  const token = p.token ?? state.claimAction(slug, action);
  let verdict = { done: false, detail: 'not checked' };
  try {
    for (;;) {
      try {
        verdict = await deps.check(namespace, slug, expect);
      } catch (err) {
        verdict = { done: false, detail: k8sErrorMessage(err) };
      }
      if (verdict.done || Date.now() + deps.pollMs > deadline) break;
      await new Promise((r) => setTimeout(r, deps.pollMs));
    }
  } finally {
    state.releaseAction(slug, token);
  }

  const result = verdict.done ? 'VERIFIED' : 'UNVERIFIED';
  const seconds = Math.round(deps.verifyMs / 1000);
  const reason = verdict.done ? null : `not confirmed within ${seconds} s: ${verdict.detail}`;
  let attention = null;
  if (!verdict.done) {
    log.warn(`${slug}: ${action} not confirmed within ${seconds} s (${verdict.detail}): UNVERIFIED`);
    attention = `the ${action.toLowerCase().replace('_', ' ')} wasn't confirmed within ${seconds} s (${verdict.detail})`;
    setAppHealth(slug, 'NEEDS_ATTENTION', attention);
  } else {
    attention = attentionAfter ?? null;
    log.info(`${slug}: ${action} VERIFIED`);
    setAppHealth(slug, attentionAfter ? 'NEEDS_ATTENTION' : 'HEALTHY', attentionAfter ?? null);
  }

  // record second
  const data = { result, verifiedAt: verdict.done ? new Date() : null, ...(reason && { reason }) };
  let id = await Promise.resolve(attemptId).catch(() => null);
  if (!id && p.attempt) {
    // no row yet (the database was down): the queued attempt carries the result
    Object.assign(p.attempt, data);
    id = savedIds.get(p.attempt) ?? null;
    if (!id) {
      lateResults.set(p.attempt, data);
      log.info(`${slug}: ${action} ${result}, saved with the attempt once the database is back`);
    }
  }
  if (id) {
    await deps.db.remediationAttempt
      .update({ where: { id }, data })
      .catch(async (err) => {
        log.warn(`could not save the verification of ${slug}'s ${action}: ${errorMessage(err)}. Retrying once`);
        await new Promise((r) => setTimeout(r, 1000));
        await deps.db.remediationAttempt.update({ where: { id }, data }).catch(() => {});
      });
    // FR-55, FR-73: stopping opens (or comments on) the app's GitHub issue
    if (attention) deps.onAttention?.(id, attention)?.catch?.(() => {});
  }
  return { result, detail: verdict.done ? undefined : verdict.detail };
}

// At boot: attempts still APPLIED (the backend stopped during their check)
// get the rest of their 90 s, or one check now if that has passed. Only the
// last 10 minutes: an older one's check says nothing about the action anymore.
export const RESUME_WITHIN_MS = 10 * 60 * 1000;

export async function resumeVerifications(now = Date.now()) {
  const pending = await prisma.remediationAttempt.findMany({
    where: { result: 'APPLIED', verifiedAt: null, attemptedAt: { gte: new Date(now - RESUME_WITHIN_MS) } },
    include: { toRelease: true, incident: { include: { app: true } } },
  });
  for (const a of pending) {
    const app = a.incident.app;
    if (app.deletedAt) continue;
    const expect = a.action === 'ROLLBACK' && a.toRelease ? { image: a.toRelease.imageRef } : a.action.startsWith('SCALE') ? { replicas: app.replicas } : {};
    verifyAction({
      slug: app.slug,
      namespace: app.namespace,
      action: a.action,
      expect,
      attemptId: a.id,
      startedAt: Math.max(a.attemptedAt.getTime(), now - VERIFY_MS + POLL_MS),
    }).catch((err) => log.error(`resuming the check of ${app.slug}'s ${a.action} failed`, err));
  }
  return pending.length;
}
