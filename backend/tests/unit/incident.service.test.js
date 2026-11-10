import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { withRetry, WRITE_FAILED } from '../../src/remediation/incident/incident.service.js';
import * as memory from '../../src/remediation/incident/incident.state.js';
import { beginRollout, endRollout, isRolloutInProgress } from '../../src/state/rollout.state.js';

describe('withRetry (FR-74)', () => {
  it('returns the first result when the write works', async () => {
    let calls = 0;
    assert.equal(await withRetry('x', async () => (++calls, 'ok'), 0), 'ok');
    assert.equal(calls, 1);
  });

  it('retries once after a failure', async () => {
    let calls = 0;
    const write = async () => {
      if (++calls === 1) throw new Error('db down');
      return 'ok';
    };
    assert.equal(await withRetry('x', write, 0), 'ok');
    assert.equal(calls, 2);
  });

  it('gives up after two failures without throwing', async () => {
    let calls = 0;
    const result = await withRetry('x', async () => { calls++; throw new Error('db down'); }, 0);
    assert.equal(result, WRITE_FAILED);
    assert.equal(calls, 2);
  });
});

describe('incident memory', () => {
  beforeEach(() => memory._reset());

  it('treats a fingerprint as open until it is closed', () => {
    memory.markOpen('fp1', { alertName: 'KairoOOMKilled' });
    assert.equal(memory.isOpen('fp1'), true);
    const entry = memory.close('fp1');
    assert.equal(entry.pending.alertName, 'KairoOOMKilled');
    assert.equal(memory.isOpen('fp1'), false);
  });

  it('drops the pending record once it is in the database', () => {
    memory.markOpen('fp1', { alertName: 'KairoOOMKilled' });
    memory.markRecorded('fp1', 'inc1');
    assert.deepEqual(memory.close('fp1'), { incidentId: 'inc1', pending: null });
  });

  it('keeps failed writes queued until they are taken', () => {
    memory.queueWrite({ kind: 'resolve', fingerprint: 'fp1', resolvedAt: new Date() });
    memory.markOpen('fp2', { alertName: 'KairoAppDown' });
    assert.equal(memory.unsavedCount(), 2);
    assert.equal(memory.takeOutbox().length, 1);
    assert.deepEqual(memory.unsavedOpen().map((u) => u.fingerprint), ['fp2']);
  });

  it('finds a remembered app without the database', async () => {
    memory.rememberApp({ id: 'a1', slug: 'node-sample', namespace: 'kairo-node-sample' });
    assert.deepEqual(await memory.findApp('node-sample', 'kairo-node-sample'), {
      id: 'a1',
      slug: 'node-sample',
      namespace: 'kairo-node-sample',
    });
  });
});

describe('rollout lock', () => {
  it('is set from begin to end', () => {
    beginRollout('node-sample');
    assert.equal(isRolloutInProgress('node-sample'), true);
    endRollout('node-sample');
    assert.equal(isRolloutInProgress('node-sample'), false);
  });
});
