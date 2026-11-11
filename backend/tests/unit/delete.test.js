import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { prisma } from '../../src/db/index.js';
import * as healing from '../../src/remediation/healing/healing.state.js';
import { deleteApp } from '../../src/services/delete.service.js';
import { beginRollout, endRollout } from '../../src/state/rollout.state.js';

// prisma's model methods sit behind a proxy, so they are swapped by hand
const restores = [];
function stub(delegate, name, fn) {
  const original = delegate[name];
  delegate[name] = fn;
  restores.push(() => (delegate[name] = original));
}

const APP = {
  id: 'a1',
  slug: 'demo',
  namespace: 'kairo-demo',
  releases: [{ imageRef: 'kairo/demo:aaa' }, { imageRef: 'kairo/demo:aaa' }, { imageRef: 'kairo/broken-release:1' }, { imageRef: 'ghcr.io/me/demo:bbb' }],
};

let calls;
let deps;

beforeEach(() => {
  calls = { namespace: [], rules: [], cleanUp: [], appUpdate: [], incidents: [] };
  deps = {
    deleteNamespace: async (ns) => (calls.namespace.push(ns), 'deleting'),
    deleteAlertRules: async (slug) => calls.rules.push(slug),
    cleanUpLater: (app, images) => calls.cleanUp.push(images),
  };
  healing._reset();
  healing.setAutoHealState('demo', false);
  stub(prisma.app, 'findFirst', async () => APP);
  stub(prisma.pipelineRun, 'findFirst', async () => null);
  stub(prisma.incident, 'updateMany', (args) => (calls.incidents.push(args), { count: 2 }));
  stub(prisma.app, 'update', (args) => (calls.appUpdate.push(args), {}));
  stub(prisma, '$transaction', async (ops) => Promise.all(ops));
});
afterEach(() => {
  while (restores.length) restores.pop()();
  endRollout('demo');
  healing._reset();
});

describe('deleting an app (FR-65, FR-66)', () => {
  it('needs the app name typed to confirm', async () => {
    await assert.rejects(deleteApp('demo', 'dem', deps), { statusCode: 400 });
    await assert.rejects(deleteApp('demo', undefined, deps), { statusCode: 400 });
    assert.deepEqual(calls.namespace, []);
  });

  it('waits for a pipeline run, a rollout or a checked action to end', async () => {
    stub(prisma.pipelineRun, 'findFirst', async () => ({ id: 'run1' }));
    await assert.rejects(deleteApp('demo', 'demo', deps), { statusCode: 409 });
    restores.pop()();

    beginRollout('demo');
    await assert.rejects(deleteApp('demo', 'demo', deps), { statusCode: 409 });
    endRollout('demo');

    healing.claimAction('demo', 'RESTART');
    await assert.rejects(deleteApp('demo', 'demo', deps), { statusCode: 409 });
    assert.deepEqual(calls.namespace, []);
  });

  it('removes the namespace and alert rules, keeps history, and forgets the app', async () => {
    const res = await deleteApp('demo', 'demo', deps);
    assert.deepEqual(calls.namespace, ['kairo-demo']);
    assert.deepEqual(calls.rules, ['demo']);
    // open incidents closed without a recovery time; nothing deleted from the database
    assert.deepEqual(calls.incidents[0].data.status, 'RESOLVED');
    assert.equal(calls.incidents[0].data.recoverySeconds, undefined);
    assert.ok(calls.appUpdate[0].data.deletedAt instanceof Date);
    // each image once, and never Break It's shared one
    assert.deepEqual(calls.cleanUp, [['kairo/demo:aaa', 'ghcr.io/me/demo:bbb']]);
    assert.equal(res.closedIncidents, 2);
    // healing memory is gone: the defaults again
    assert.equal(healing.isAutoHeal('demo'), true);
  });

  it('marks nothing deleted when the cluster refuses, so Delete can be tried again', async () => {
    deps.deleteNamespace = async () => {
      throw new Error('connection refused');
    };
    await assert.rejects(deleteApp('demo', 'demo', deps), { statusCode: 502 });
    assert.deepEqual(calls.appUpdate, []);
    assert.equal(healing.isAutoHeal('demo'), false, 'still known to healing');
  });

  it('404 for an unknown or deleted app', async () => {
    stub(prisma.app, 'findFirst', async () => null);
    await assert.rejects(deleteApp('nope', 'nope', deps), { statusCode: 404 });
  });
});
