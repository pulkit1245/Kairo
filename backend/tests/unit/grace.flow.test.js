import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { prisma } from '../../src/db/index.js';
import { handleAlert, hasOpenIncident, runDeferredActions } from '../../src/remediation/incident/incident.service.js';
import * as memory from '../../src/remediation/incident/incident.state.js';
import { _resetGrace, configureGrace, endGrace, inGrace, startGrace } from '../../src/shipping/grace.service.js';

// The whole FR-71 / FR-72 flow for an alert that fires and resolves inside a
// grace window, with the database and the cluster stubbed out:
//   rollout -> window -> alert fires (recorded, action deferred) -> alert
//   resolves -> window ends -> no action ever runs, and the release is
//   judged at the end only: nothing fires then and every replica is ready,
//   so it is marked healthy (FR-72).

const app = { id: 'a1', slug: 'demo', namespace: 'kairo-demo' };

// Prisma's model methods sit behind a proxy that node:test's mock.method can't
// see, so they are swapped by hand and put back after each test
const restores = [];
function stub(delegate, name, fn) {
  const original = delegate[name];
  delegate[name] = fn;
  restores.push(() => (delegate[name] = original));
}

describe('an alert that fires and resolves inside the grace window', () => {
  let writes;
  const deployedAt = new Date();
  const release = { id: 'r1', appId: 'a1', commitSha: 'b'.repeat(40), imageRef: 'ghcr.io/o/demo:b', status: 'ACTIVE', healthyAt: null, deployedAt };

  beforeEach(() => {
    _resetGrace();
    memory._reset();
    memory.rememberApp(app);
    writes = { incidents: [], attempts: [], resolved: [], healthy: [], deleted: [] };

    stub(prisma.incident, 'create', async ({ data }) => (writes.incidents.push(data), { id: 'inc1' }));
    stub(prisma.incident, 'findMany', async () => [{ id: 'inc1', startedAt: data0.startsAt }]);
    stub(prisma.incident, 'update', async ({ where, data }) => writes.resolved.push({ id: where.id, ...data }));
    stub(prisma.remediationAttempt, 'create', async ({ data }) => (writes.attempts.push(data), { id: 'att1' }));
    stub(prisma.release, 'findUnique', async () => ({ ...release, app }));
    stub(prisma.release, 'updateMany', async ({ where }) => (writes.healthy.push(where.id), { count: 1 }));

    configureGrace({
      isAlerting: hasOpenIncident,
      onEnd: runDeferredActions,
      releaseReady: async () => ({ ready: true }),
    });
  });

  afterEach(() => {
    while (restores.length) restores.pop()();
    _resetGrace();
    memory._reset();
  });

  const data0 = {
    fingerprint: 'fp-oom',
    alertName: 'KairoOOMKilled',
    appName: 'demo',
    namespace: 'kairo-demo',
    pod: 'demo-abc',
    summary: 'Container went over its memory limit',
    startsAt: new Date(deployedAt.getTime() + 20_000),
    endsAt: null,
  };

  it('is recorded with no action, and the release is judged at the end of the window', async () => {
    startGrace(release, app);
    assert.equal(inGrace('demo'), true);

    // fires 20 s into the window
    assert.equal(await handleAlert({ ...data0, firing: true }), 'opened');
    assert.equal(writes.incidents.length, 1);
    assert.equal(writes.incidents[0].alertName, 'KairoOOMKilled');
    assert.equal(writes.incidents[0].attempts, undefined, 'recorded without an attempt');
    assert.deepEqual(memory.deferredFor('demo'), ['fp-oom']);
    assert.equal(hasOpenIncident('demo'), true);

    // resolves 40 s into the window
    const endsAt = new Date(deployedAt.getTime() + 40_000);
    assert.equal(await handleAlert({ ...data0, firing: false, endsAt }), 'resolved');
    assert.equal(writes.resolved[0].status, 'RESOLVED');
    assert.equal(writes.resolved[0].recoverySeconds, 20);
    assert.equal(hasOpenIncident('demo'), false);

    // the window ends
    const verdict = await endGrace('r1');
    assert.equal(inGrace('demo'), false);
    assert.deepEqual(writes.attempts, [], 'no action ran, then or at the end of the window');
    assert.deepEqual(memory.deferredFor('demo'), []);
    // FR-72: nothing fires at the end and every replica is ready
    assert.deepEqual(verdict, { healthy: true });
    assert.deepEqual(writes.healthy, ['r1']);
  });

  it('keeps the release unmarked when the alert is still firing at the end', async () => {
    startGrace(release, app);
    await handleAlert({ ...data0, firing: true });
    // stop the deferred action from reaching the cluster: what matters here is the verdict
    configureGrace({ onEnd: async () => {} });

    const verdict = await endGrace('r1');
    assert.equal(verdict.healthy, false);
    assert.match(verdict.reason, /alert is firing/);
    assert.deepEqual(writes.healthy, []);
    assert.deepEqual(memory.deferredFor('demo'), ['fp-oom'], 'its action still waits to run');
  });
});
