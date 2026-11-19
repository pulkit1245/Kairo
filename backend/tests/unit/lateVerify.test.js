import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { prisma } from '../../src/db/index.js';
import * as state from '../../src/remediation/healing/healing.state.js';
import { attemptSaved, verifyAction } from '../../src/remediation/healing/verify.service.js';
import { flushUnsaved } from '../../src/remediation/incident/incident.service.js';
import * as memory from '../../src/remediation/incident/incident.state.js';

// P5f: with Postgres stopped, Kairo restarted the pod and verified it, but the
// incident (with its attempt) was saved only once the database was back, and
// the verification was lost: the attempt read APPLIED for good. A check that
// ends before its attempt has a row must still record its result.

const restores = [];
function stub(delegate, name, fn) {
  const original = delegate[name];
  delegate[name] = fn;
  restores.push(() => (delegate[name] = original));
}
beforeEach(() => {
  state._reset();
  memory._reset();
  stub(prisma.app, 'updateMany', async () => ({ count: 1 }));
});
afterEach(() => {
  while (restores.length) restores.pop()();
});

const attemptMade = () => ({ action: 'RESTART', trigger: 'AUTO', dryRun: false, result: 'APPLIED', attemptedAt: new Date('2026-11-19T11:27:44Z') });
const fakeDb = (updates) => ({ remediationAttempt: { update: async (q) => updates.push(q) } });
const fast = (check, updates) => ({ check, pollMs: 1, verifyMs: 30, db: fakeDb(updates) });
// what heal() hands over when the first write failed: no id
const noRow = Promise.resolve(null);

describe('a verification that ends before its attempt has a row', () => {
  it('the check ends first: the queued attempt carries VERIFIED, and the save writes it', async () => {
    const attempt = attemptMade();
    const early = [];
    const res = await verifyAction({ slug: 'demo', namespace: 'kairo-demo', action: 'RESTART', expect: {}, attemptId: noRow, attempt }, fast(async () => ({ done: true }), early));
    assert.equal(res.result, 'VERIFIED');
    assert.equal(early.length, 0, 'no row to update yet');
    assert.equal(attempt.result, 'VERIFIED');
    assert.ok(attempt.verifiedAt instanceof Date);

    const late = [];
    await attemptSaved(attempt, 'row-1', fakeDb(late));
    assert.equal(late.length, 1);
    assert.equal(late[0].where.id, 'row-1');
    assert.equal(late[0].data.result, 'VERIFIED');
    // only once
    await attemptSaved(attempt, 'row-1', fakeDb(late));
    assert.equal(late.length, 1);
  });

  it('the row is saved first, while the check still runs: the check updates that row', async () => {
    const attempt = attemptMade();
    const updates = [];
    let calls = 0;
    const check = async () => {
      if (++calls === 1) await attemptSaved(attempt, 'row-2', fakeDb([])); // the flush saves it meanwhile
      return { done: calls >= 2 };
    };
    await verifyAction({ slug: 'demo', namespace: 'kairo-demo', action: 'RESTART', expect: {}, attemptId: noRow, attempt }, fast(check, updates));
    assert.equal(updates.length, 1);
    assert.equal(updates[0].where.id, 'row-2');
    assert.equal(updates[0].data.result, 'VERIFIED');
  });

  it('an UNVERIFIED result is kept the same way, with its reason', async () => {
    const attempt = attemptMade();
    await verifyAction({ slug: 'demo', namespace: 'kairo-demo', action: 'RESTART', expect: {}, attemptId: noRow, attempt }, fast(async () => ({ done: false, detail: 'pod is Pending' }), []));
    assert.equal(attempt.result, 'UNVERIFIED');
    assert.equal(attempt.verifiedAt, null);
    assert.match(attempt.reason, /not confirmed within 0 s: pod is Pending/);
  });

  it("end to end: the incident saved by the flush has the attempt VERIFIED (P5f's case)", async () => {
    const attempt = attemptMade();
    memory.markOpen('fp-oom', { slug: 'demo', appId: 'a1', fingerprint: 'fp-oom', alertName: 'KairoOOMKilled', pod: 'p', cause: 'out of memory', startedAt: new Date('2026-11-19T11:27:34Z'), attempt });
    await verifyAction({ slug: 'demo', namespace: 'kairo-demo', action: 'RESTART', expect: {}, attemptId: noRow, attempt }, fast(async () => ({ done: true }), []));

    const created = [];
    const updated = [];
    stub(prisma.incident, 'create', async (q) => {
      created.push(q);
      return { id: 'inc-1', attempts: [{ id: 'row-3' }] };
    });
    stub(prisma.remediationAttempt, 'update', async (q) => updated.push(q));
    assert.equal(await flushUnsaved(), 1);
    const saved = created[0].data.attempts.create[0];
    assert.equal(saved.result, 'VERIFIED');
    assert.ok(saved.verifiedAt instanceof Date);
    // and the row is written once more with the same result, harmless
    assert.equal(updated[0].where.id, 'row-3');
    assert.equal(updated[0].data.result, 'VERIFIED');
  });

  it('an attempt saved normally (the database up) is updated by id, as before', async () => {
    const attempt = attemptMade();
    const updates = [];
    await verifyAction({ slug: 'demo', namespace: 'kairo-demo', action: 'RESTART', expect: {}, attemptId: Promise.resolve('row-4'), attempt }, fast(async () => ({ done: true }), updates));
    assert.equal(updates.length, 1);
    assert.equal(updates[0].where.id, 'row-4');
    assert.equal(attempt.result, 'APPLIED', 'the in-memory attempt is left alone');
  });
});
