import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { prisma } from '../../src/db/index.js';
import { pickRollbackTarget } from '../../src/remediation/action/executor.service.js';
import { heal } from '../../src/remediation/healing/heal.service.js';
import * as state from '../../src/remediation/healing/healing.state.js';
import { clearOnHealthyRelease, clearQuietApps, setAppHealth } from '../../src/remediation/healing/health.service.js';
import { verifyAction } from '../../src/remediation/healing/verify.service.js';
import { checkScaleDown } from '../../src/remediation/scaling/scaledown.service.js';
import { _resetGrace } from '../../src/shipping/grace.service.js';
import { imagesToPrune, keptReleases } from '../../src/shipping/prune.service.js';
import { beginRollout, endRollout } from '../../src/state/rollout.state.js';

const app = { id: 'a1', slug: 'demo', namespace: 'kairo-demo' };

// health writes go to the App row in the background; keep them off the database
const restores = [];
function stub(delegate, name, fn) {
  const original = delegate[name];
  delegate[name] = fn;
  restores.push(() => (delegate[name] = original));
}

beforeEach(() => {
  state._reset();
  _resetGrace();
  stub(prisma.app, 'updateMany', async () => ({ count: 1 }));
});
afterEach(() => {
  while (restores.length) restores.pop()();
  endRollout('demo');
  state._reset();
});

describe('the healing gate (FR-48, FR-51, FR-73)', () => {
  it('skips an alert with no action', async () => {
    const { attempt, note } = await heal(app, 'NONE', {});
    assert.equal(attempt.result, 'SKIPPED');
    assert.equal(note, 'no action for this alert');
  });

  it('does nothing once the app needs attention', async () => {
    setAppHealth('demo', 'NEEDS_ATTENTION', 'x');
    const { attempt, note } = await heal(app, 'RESTART', { pod: 'p' });
    assert.equal(attempt.result, 'SKIPPED');
    assert.match(note, /stopped acting/);
  });

  it('with auto-heal off: records what it would do, touches nothing, needs attention (AQ9)', async () => {
    state.setAutoHealState('demo', false);
    const { attempt, note } = await heal(app, 'RESTART', { pod: 'p' });
    assert.deepEqual([attempt.action, attempt.result, note], ['RESTART', 'SKIPPED', 'auto-heal is off']);
    assert.equal(attempt.reason, 'auto-heal is off', 'stored, for the drawer');
    assert.equal(state.getHealth('demo'), 'NEEDS_ATTENTION');
    assert.equal(state.attentionReason('demo'), 'an alert fired with auto-heal off');
    assert.equal(state.recentAttempts('demo'), 0, 'a skipped attempt never counts');
  });

  it('gives up after 3 attempts in 10 minutes', async () => {
    for (let i = 0; i < 3; i++) state.countAttempt('demo');
    const { attempt, note } = await heal(app, 'RESTART', { pod: 'p' });
    assert.equal(attempt.result, 'SKIPPED');
    assert.match(note, /gave up/);
    assert.equal(attempt.reason, 'gave up: 3 attempts in 10 minutes');
    assert.equal(state.getHealth('demo'), 'NEEDS_ATTENTION');
  });

  it('keeps counting across verified actions, so the 4th within 10 minutes gives up', async () => {
    const fast = { check: async () => ({ done: true }), pollMs: 1, verifyMs: 10, db: { remediationAttempt: { update: async () => {} } } };
    for (let i = 0; i < 3; i++) {
      state.countAttempt('demo');
      setAppHealth('demo', 'HEALING');
      await verifyAction({ slug: 'demo', namespace: 'kairo-demo', action: 'RESTART', expect: {}, attemptId: null }, fast);
      assert.equal(state.getHealth('demo'), 'HEALTHY');
    }
    assert.equal(state.recentAttempts('demo'), 3);
    assert.match((await heal(app, 'RESTART', { pod: 'p' })).note, /gave up/);
  });

  it('forgets attempts older than 10 minutes', () => {
    const now = Date.now();
    state.countAttempt('demo', now - 11 * 60_000);
    state.countAttempt('demo', now - 60_000);
    assert.equal(state.recentAttempts('demo', now), 1);
  });

  it('skips while the app rolls out or another action is checked', async () => {
    beginRollout('demo');
    assert.match((await heal(app, 'RESTART', { pod: 'p' })).note, /rollout is in progress/);
    endRollout('demo');
    state.claimAction('demo', 'SCALE_UP');
    assert.match((await heal(app, 'RESTART', { pod: 'p' })).note, /being verified/);
  });

  it('claims the app at once; only a rollback may take over, and only its holder releases it', () => {
    const restart = state.claimAction('demo', 'RESTART');
    assert.ok(restart);
    assert.equal(state.claimAction('demo', 'SCALE_UP'), null);
    const rollback = state.claimAction('demo', 'ROLLBACK');
    assert.ok(rollback);
    assert.equal(state.claimAction('demo', 'ROLLBACK'), null, 'not two rollbacks');
    state.releaseAction('demo', restart); // the restart's check ends: the rollback keeps the app
    assert.equal(state.isVerifying('demo'), true);
    state.releaseAction('demo', rollback);
    assert.equal(state.isVerifying('demo'), false);
  });
});

describe('verification (FR-73)', () => {
  const fast = (check, updates) => ({
    check,
    pollMs: 1,
    verifyMs: 30,
    db: { remediationAttempt: { update: async (q) => updates.push(q) } },
  });

  it('VERIFIED once the action took effect, and the app is healthy again', async () => {
    const updates = [];
    let calls = 0;
    setAppHealth('demo', 'HEALING');
    const res = await verifyAction(
      { slug: 'demo', namespace: 'kairo-demo', action: 'RESTART', expect: { gone: 'p' }, attemptId: Promise.resolve('att1') },
      fast(async () => ({ done: ++calls >= 2 }), updates),
    );
    assert.equal(res.result, 'VERIFIED');
    assert.equal(state.getHealth('demo'), 'HEALTHY');
    assert.equal(updates[0].where.id, 'att1');
    assert.equal(updates[0].data.result, 'VERIFIED');
    assert.ok(updates[0].data.verifiedAt instanceof Date);
    assert.equal(state.isVerifying('demo'), false);
  });

  it('UNVERIFIED when it never does: the app needs attention', async () => {
    const updates = [];
    const res = await verifyAction(
      { slug: 'demo', namespace: 'kairo-demo', action: 'ROLLBACK', expect: { image: 'x' }, attemptId: 'att2' },
      fast(async () => ({ done: false, detail: 'CrashLoopBackOff' }), updates),
    );
    assert.deepEqual(res, { result: 'UNVERIFIED', detail: 'CrashLoopBackOff' });
    assert.equal(state.getHealth('demo'), 'NEEDS_ATTENTION');
    assert.match(state.attentionReason('demo'), /rollback wasn't confirmed within 0 s \(CrashLoopBackOff\)/);
    assert.deepEqual(updates[0].data, { result: 'UNVERIFIED', verifiedAt: null, reason: 'not confirmed within 0 s: CrashLoopBackOff' });
  });

  it('a restart with no rollback target needs attention even when it works (FR-50)', async () => {
    await verifyAction(
      { slug: 'demo', namespace: 'kairo-demo', action: 'RESTART', expect: {}, attemptId: null, attentionAfter: 'no earlier healthy release to roll back to' },
      fast(async () => ({ done: true }), []),
    );
    assert.equal(state.getHealth('demo'), 'NEEDS_ATTENTION');
    assert.equal(state.attentionReason('demo'), 'no earlier healthy release to roll back to');
  });
});

describe('rollback target (FR-50)', () => {
  const at = (m) => new Date(Date.UTC(2026, 10, 11, 12, m));
  const rel = (id, m, imageRef, healthy, extra = {}) => ({ id, deployedAt: at(m), imageRef, healthyAt: healthy ? at(m + 1) : null, status: 'SUPERSEDED', source: 'GHCR', commitSha: id, ...extra });

  it('is the newest earlier healthy release whose image is stored, not the one running', () => {
    const releases = [
      rel('r1', 1, 'img:1', true),
      rel('r2', 2, 'img:2', true),
      rel('r3', 3, 'img:3', false),
      rel('t1', 4, 'kairo/broken-release:1', false, { status: 'ACTIVE', source: 'TEST' }),
    ];
    assert.equal(pickRollbackTarget(releases, 'kairo/broken-release:1').id, 'r2');
    assert.equal(pickRollbackTarget(releases, 'img:2').id, 'r1');
  });

  it('is none when no earlier release was ever healthy', () => {
    assert.equal(pickRollbackTarget([rel('r1', 1, 'img:1', false), rel('r2', 2, 'img:2', true)], 'img:2'), null);
  });

  it('skips a healthy release whose image was pruned', () => {
    const releases = [1, 2, 3, 4, 5].map((m) => rel(`r${m}`, m, `img:${m}`, m === 1));
    // r1 is the newest healthy, so it keeps its image; healthy r1 with a pruned image can't happen
    assert.equal(pickRollbackTarget(releases, 'img:5').id, 'r1');
    const prunedHealthy = [rel('r1', 1, 'img:1', true), ...[2, 3, 4, 5].map((m) => rel(`r${m}`, m, `img:${m}`, true))];
    assert.equal(pickRollbackTarget(prunedHealthy, 'img:5').id, 'r4');
  });
});

describe('NEEDS_ATTENTION clears (FR-49)', () => {
  const db = (newest) => ({ incident: { findFirst: async () => newest } });

  it('after 10 quiet minutes, counted from the later of entering it and the last resolve', async () => {
    const now = Date.now();
    state.setHealthState('demo', 'NEEDS_ATTENTION', 'x', now - 11 * 60_000);
    const resolvedRecently = { status: 'RESOLVED', resolvedAt: new Date(now - 5 * 60_000) };
    assert.deepEqual(await clearQuietApps({ isAlerting: () => false, now, db: db(resolvedRecently) }), []);
    const resolvedLongAgo = { status: 'RESOLVED', resolvedAt: new Date(now - 30 * 60_000) };
    assert.deepEqual(await clearQuietApps({ isAlerting: () => false, now, db: db(resolvedLongAgo) }), ['demo']);
    assert.equal(state.getHealth('demo'), 'HEALTHY');
  });

  it('never while an alert is open', async () => {
    state.setHealthState('demo', 'NEEDS_ATTENTION', 'x', Date.now() - 60 * 60_000);
    assert.deepEqual(await clearQuietApps({ isAlerting: () => true, db: db(null) }), []);
  });

  it('when a release is newly marked healthy, and the give-up count starts again', () => {
    state.countAttempt('demo');
    setAppHealth('demo', 'NEEDS_ATTENTION', 'x');
    assert.equal(clearOnHealthyRelease('demo', { commitSha: 'abcdef0123' }), true);
    assert.equal(state.getHealth('demo'), 'HEALTHY');
    assert.equal(state.recentAttempts('demo'), 0);
  });
});

describe('scale-down check (FR-47)', () => {
  const deps = ({ samples = 10, peak = 0.005, incident = { id: 'inc1' } } = {}) => {
    const calls = { heal: [], attempts: [] };
    return {
      calls,
      deps: {
        queryNumber: async (q) => (q.startsWith('count_over_time') ? samples : peak),
        heal: async (a, action) => (calls.heal.push(action), { attempt: { action, result: 'APPLIED' }, followUp: () => null }),
        db: {
          app: { findMany: async () => [{ ...app, replicas: 2 }] },
          incident: { findFirst: async () => incident },
          remediationAttempt: { create: async ({ data }) => (calls.attempts.push(data), { id: 'att9' }) },
        },
      },
    };
  };

  it('scales back to 1 after 5 quiet minutes, attached to the scale-up incident', async () => {
    const { deps: d, calls } = deps();
    const [res] = await checkScaleDown(d);
    assert.equal(res.state, 'scaled down');
    assert.deepEqual(calls.heal, ['SCALE_DOWN']);
    assert.equal(calls.attempts[0].incidentId, 'inc1');
  });

  it('waits while a pod is still over 30% of its request, or there is too little data', async () => {
    assert.equal((await checkScaleDown(deps({ peak: 0.05 }).deps))[0].state, 'busy enough');
    assert.equal((await checkScaleDown(deps({ samples: 4 }).deps))[0].state, 'not enough data');
  });

  it('leaves an app alone with auto-heal off or needing attention', async () => {
    state.setAutoHealState('demo', false);
    assert.equal((await checkScaleDown(deps().deps))[0].state, 'not acting');
  });
});

describe('pruning and Break It releases', () => {
  const at = (m) => new Date(Date.UTC(2026, 10, 11, 12, m));
  it("a TEST release doesn't take a kept place, and the shared broken image is never pruned", () => {
    const releases = [
      { id: 'r1', imageRef: 'img:1', status: 'SUPERSEDED', source: 'GHCR', healthyAt: at(2), deployedAt: at(1) },
      { id: 'r2', imageRef: 'img:2', status: 'SUPERSEDED', source: 'GHCR', healthyAt: at(3), deployedAt: at(2) },
      { id: 'r3', imageRef: 'img:3', status: 'ACTIVE', source: 'GHCR', healthyAt: at(4), deployedAt: at(3) },
      { id: 't1', imageRef: 'kairo/broken-release:1', status: 'ROLLED_BACK', source: 'TEST', healthyAt: null, deployedAt: at(4) },
    ];
    assert.deepEqual([...keptReleases(releases)].sort(), ['r1', 'r2', 'r3']);
    assert.deepEqual(imagesToPrune(releases), []);
  });
});
