import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { prisma } from '../../src/db/index.js';
import { handleAlert, hasOpenIncident, runDeferredActions } from '../../src/remediation/incident/incident.service.js';
import * as memory from '../../src/remediation/incident/incident.state.js';
import { _resetGrace, configureGrace, endGrace, inGrace, rebuildGrace, startGrace } from '../../src/shipping/grace.service.js';

// The whole FR-71 / FR-72 flow for alerts inside a grace window, with the
// database and the cluster stubbed out:
//   rollout -> window -> alert fires (recorded, action deferred) -> alert
//   resolves, or not -> window ends -> verdict, then the deferred actions.
//
// FR-72 as updated on 11 Nov: the release is judged at the end of the window
// (every replica ready, nothing firing), and a KairoOOMKilled or KairoCrashLoop
// that fired inside the window rules it out even if it has resolved.

const app = { id: 'a1', slug: 'demo', namespace: 'kairo-demo' };

// Prisma's model methods sit behind a proxy that node:test's mock.method can't
// see, so they are swapped by hand and put back after each test
const restores = [];
function stub(delegate, name, fn) {
  const original = delegate[name];
  delegate[name] = fn;
  restores.push(() => (delegate[name] = original));
}

describe('alerts inside the grace window (FR-71, FR-72)', () => {
  let writes;
  let deployedAt;
  let release;

  const alert = (alertName, fields = {}) => ({
    fingerprint: `fp-${alertName}`,
    alertName,
    appName: 'demo',
    namespace: 'kairo-demo',
    pod: 'demo-abc',
    summary: alertName,
    startsAt: new Date(deployedAt.getTime() + 20_000),
    endsAt: null,
    ...fields,
  });

  // fires 20 s into the window, resolves 40 s into it
  async function firesAndResolves(alertName) {
    assert.equal(await handleAlert({ ...alert(alertName), firing: true }), 'opened');
    const endsAt = new Date(deployedAt.getTime() + 40_000);
    assert.equal(await handleAlert({ ...alert(alertName), firing: false, endsAt }), 'resolved');
  }

  beforeEach(() => {
    _resetGrace();
    memory._reset();
    memory.rememberApp(app);
    deployedAt = new Date();
    release = { id: 'r1', appId: 'a1', commitSha: 'b'.repeat(40), imageRef: 'ghcr.io/o/demo:b', status: 'ACTIVE', healthyAt: null, deployedAt };
    writes = { incidents: [], attempts: [], resolved: [], healthy: [] };

    stub(prisma.incident, 'create', async ({ data }) => (writes.incidents.push(data), { id: `inc${writes.incidents.length}` }));
    stub(prisma.incident, 'findMany', async () => [{ id: 'inc1', startedAt: new Date(deployedAt.getTime() + 20_000) }]);
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

  it('an OOM kill that resolves is recorded with no action, and still blocks the healthy mark', async () => {
    startGrace(release, app);
    assert.equal(inGrace('demo'), true);
    await firesAndResolves('KairoOOMKilled');

    assert.equal(writes.incidents.length, 1);
    assert.equal(writes.incidents[0].alertName, 'KairoOOMKilled');
    assert.equal(writes.incidents[0].pod, 'demo-abc');
    assert.equal(writes.incidents[0].attempts, undefined, 'recorded without an attempt');
    assert.equal(writes.resolved[0].status, 'RESOLVED');
    assert.equal(writes.resolved[0].recoverySeconds, 20);
    assert.equal(hasOpenIncident('demo'), false);

    const verdict = await endGrace('r1');
    assert.equal(inGrace('demo'), false);
    assert.deepEqual(writes.attempts, [], 'no action ran, then or at the end of the window');
    assert.deepEqual(verdict, { healthy: false, reason: 'KairoOOMKilled fired during the grace window' });
    assert.deepEqual(writes.healthy, []);
  });

  it('a crash loop that resolves blocks it too', async () => {
    startGrace(release, app);
    await firesAndResolves('KairoCrashLoop');
    const verdict = await endGrace('r1');
    assert.equal(verdict.healthy, false);
    assert.match(verdict.reason, /KairoCrashLoop fired during the grace window/);
    assert.deepEqual(writes.attempts, []);
  });

  it('any other alert that resolves leaves the release healthy (FR-72 judges the end)', async () => {
    startGrace(release, app);
    await firesAndResolves('KairoHighCpu');
    assert.equal(writes.incidents[0].attempts, undefined);

    const verdict = await endGrace('r1');
    assert.deepEqual(writes.attempts, []);
    assert.deepEqual(verdict, { healthy: true });
    assert.deepEqual(writes.healthy, ['r1']);
  });

  it('an alert still firing at the end keeps it unmarked, and its action still waits', async () => {
    startGrace(release, app);
    await handleAlert({ ...alert('KairoHighCpu'), firing: true });
    // stop the deferred action from reaching the cluster: what matters here is the verdict
    configureGrace({ onEnd: async () => {} });

    const verdict = await endGrace('r1');
    assert.equal(verdict.healthy, false);
    assert.match(verdict.reason, /alert is firing/);
    assert.deepEqual(writes.healthy, []);
    assert.deepEqual(memory.deferredFor('demo'), ['fp-KairoHighCpu']);
  });

  it('after a restart, an OOM kill already recorded in the window still blocks it', async () => {
    stub(prisma.release, 'findMany', async () => [{ ...release, app }]);
    stub(prisma.incident, 'findFirst', async ({ where }) => {
      assert.deepEqual(where.alertName.in, ['KairoOOMKilled', 'KairoCrashLoop']);
      return { alertName: 'KairoOOMKilled' };
    });
    assert.equal(await rebuildGrace(), 1);
    const verdict = await endGrace('r1');
    assert.equal(verdict.healthy, false);
    assert.match(verdict.reason, /KairoOOMKilled fired during the grace window/);
  });
});
