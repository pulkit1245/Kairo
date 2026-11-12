import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { env } from '../../src/config/env.config.js';
import { prisma } from '../../src/db/index.js';
import { heal } from '../../src/remediation/healing/heal.service.js';
import * as state from '../../src/remediation/healing/healing.state.js';
import { rollbackBlocked } from '../../src/remediation/healing/rollback.service.js';
import { verifyAction } from '../../src/remediation/healing/verify.service.js';
import { _drain, _setDeps, issueText, reportAttention, reportIncident } from '../../src/remediation/issue/issue.service.js';
import { _resetGrace, startGrace } from '../../src/shipping/grace.service.js';
import { beginRollout, endRollout } from '../../src/state/rollout.state.js';

// FR-55 (issues) and FR-61 (manual rollback), P4d

const at = new Date('2026-11-12T09:00:00Z');

function incidentRow(overrides = {}) {
  return {
    id: 'i1',
    alertName: 'KairoCrashLoop',
    cause: 'The app keeps crashing as soon as it starts',
    explanation: null,
    startedAt: at,
    githubIssueNumber: null,
    app: { slug: 'demo', repoFullName: 'someone/demo', deletedAt: null, installation: { githubInstallationId: 42 } },
    attempts: [
      {
        action: 'ROLLBACK',
        trigger: 'AUTO',
        result: 'APPLIED',
        reason: null,
        fromRelease: { commitSha: 'aaaaaaa1111', source: 'TEST' },
        toRelease: { commitSha: 'bbbbbbb2222' },
      },
    ],
    ...overrides,
  };
}

// an in-memory incident table and a fake GitHub
function fakes(rows, { openIssue = null } = {}) {
  const calls = { opened: [], comments: [], saved: [] };
  let open = openIssue;
  let next = 7;
  const db = {
    incident: {
      findUnique: async ({ where }) => rows[where.id] ?? null,
      update: async ({ where, data }) => {
        calls.saved.push([where.id, data.githubIssueNumber]);
        rows[where.id] = { ...rows[where.id], ...data };
      },
    },
    remediationAttempt: { findUnique: async ({ where }) => (where.id === 'att1' ? { incidentId: 'i1' } : null) },
  };
  const github = {
    findOpenKairoIssue: async () => open,
    openKairoIssue: async (inst, owner, repo, issue) => {
      // slow, so a second report arriving meanwhile would race without the queue
      await new Promise((r) => setTimeout(r, 20));
      calls.opened.push({ inst, owner, repo, ...issue });
      open = { number: next++, url: 'u' };
      return open;
    },
    commentOnIssue: async (inst, owner, repo, number, body) => calls.comments.push({ number, body }),
  };
  _setDeps({ github, db });
  return calls;
}

const savedGithub = { ...env.github };
beforeEach(() => {
  state._reset();
  _resetGrace();
  Object.assign(env.github, { appId: '1', appSlug: 'kairo-test', clientId: 'c', clientSecret: 's' });
});
afterEach(async () => {
  await _drain();
  _setDeps();
  Object.assign(env.github, savedGithub);
  state._reset();
  _resetGrace();
});

describe('GitHub issues (FR-55)', () => {
  it('a rollback with no open issue opens one, and the incident keeps its number', async () => {
    const rows = { i1: incidentRow() };
    const calls = fakes(rows);
    assert.equal(await reportIncident('i1'), 'opened');
    assert.equal(calls.opened.length, 1);
    const [issue] = calls.opened;
    assert.equal(issue.inst, 42);
    assert.equal(`${issue.owner}/${issue.repo}`, 'someone/demo');
    assert.equal(issue.title, 'Kairo rolled back demo');
    assert.match(issue.body, /Rolled back from the Break It release to `bbbbbbb`/);
    assert.deepEqual(calls.saved, [['i1', 7]]);
  });

  it('a later incident comments on the open issue instead of opening another', async () => {
    const rows = { i1: incidentRow({ alertName: 'KairoAppDown', attempts: [{ action: 'RESTART', trigger: 'AUTO', result: 'VERIFIED' }] }) };
    const calls = fakes(rows, { openIssue: { number: 3, url: 'u' } });
    assert.equal(await reportIncident('i1'), 'commented');
    assert.equal(calls.opened.length, 0);
    assert.equal(calls.comments[0].number, 3);
    assert.match(calls.comments[0].body, /Restarted the pod, verified/);
    assert.deepEqual(calls.saved, [['i1', 3]]);
  });

  it('a restart on a healthy app with no open issue stays on the dashboard', async () => {
    const rows = { i1: incidentRow({ attempts: [{ action: 'RESTART', trigger: 'AUTO', result: 'APPLIED' }] }) };
    const calls = fakes(rows);
    assert.equal(await reportIncident('i1'), 'none');
    assert.equal(calls.opened.length + calls.comments.length, 0);
  });

  it('a skipped rollback is not a rollback, but NEEDS_ATTENTION opens an issue', async () => {
    const rows = { i1: incidentRow({ attempts: [{ action: 'ROLLBACK', trigger: 'AUTO', result: 'SKIPPED', reason: 'auto-heal is off' }] }) };
    let calls = fakes(rows);
    assert.equal(await reportIncident('i1'), 'none');
    state.setHealthState('demo', 'NEEDS_ATTENTION', 'an alert fired with auto-heal off');
    calls = fakes(rows);
    assert.equal(await reportIncident('i1'), 'opened');
    assert.equal(calls.opened[0].title, 'Kairo stopped acting on demo');
    assert.match(calls.opened[0].body, /not done: auto-heal is off/);
  });

  it("an action check ending in NEEDS_ATTENTION reports it with the reason", async () => {
    const rows = { i1: incidentRow({ attempts: [{ action: 'RESTART', trigger: 'AUTO', result: 'VERIFIED' }] }) };
    const calls = fakes(rows);
    assert.equal(await reportAttention('att1', 'no earlier healthy release to roll back to'), 'opened');
    assert.match(calls.opened[0].body, /Kairo stopped acting on the app:\*\* no earlier healthy release/);
  });

  it('the action check hands NEEDS_ATTENTION to the issue, and only then', async () => {
    const restore = prisma.app.updateMany;
    prisma.app.updateMany = async () => ({ count: 1 });
    const told = [];
    const deps = (done) => ({
      check: async () => ({ done, detail: 'pods not ready' }),
      db: { remediationAttempt: { update: async () => {} } },
      pollMs: 1,
      verifyMs: 5,
      onAttention: async (id, reason) => told.push([id, reason]),
    });
    try {
      await verifyAction({ slug: 'demo', namespace: 'kairo-demo', action: 'RESTART', expect: {}, attemptId: 'att1' }, deps(true));
      assert.deepEqual(told, []);
      await verifyAction({ slug: 'demo', namespace: 'kairo-demo', action: 'ROLLBACK', expect: {}, attemptId: 'att1' }, deps(false));
      assert.equal(told[0][0], 'att1');
      assert.match(told[0][1], /rollback wasn't confirmed within 0 s \(pods not ready\)/);
    } finally {
      prisma.app.updateMany = restore;
    }
  });

  it('two incidents at once open one issue, the second comments (one at a time per app)', async () => {
    const rows = { i1: incidentRow(), i2: incidentRow({ id: 'i2' }) };
    const calls = fakes(rows);
    const results = await Promise.all([reportIncident('i1'), reportIncident('i2')]);
    assert.deepEqual(results.sort(), ['commented', 'opened']);
    assert.equal(calls.opened.length, 1);
    assert.equal(calls.comments.length, 1);
  });

  it('an app added from a pasted URL (no installation) gets no issue', async () => {
    const rows = { i1: incidentRow({ app: { slug: 'demo', repoFullName: 'someone/demo', deletedAt: null, installation: null } }) };
    const calls = fakes(rows);
    assert.equal(await reportIncident('i1'), 'skipped');
    assert.equal(calls.opened.length + calls.comments.length, 0);
  });

  it("a GitHub error is logged, never thrown", async () => {
    const rows = { i1: incidentRow() };
    fakes(rows);
    _setDeps({
      github: { findOpenKairoIssue: async () => Promise.reject(Object.assign(new Error('Bad credentials'), { status: 401 })) },
      db: { incident: { findUnique: async () => rows.i1 } },
    });
    assert.equal(await reportIncident('i1'), 'failed');
  });

  it("the text carries Gemini's explanation and a manual rollback's who", () => {
    const text = issueText(
      incidentRow({
        alertName: 'ManualRollback',
        cause: 'Rolled back by someone from the release list',
        explanation: 'The new release exits on start.',
        attempts: [{ action: 'ROLLBACK', trigger: 'MANUAL', result: 'VERIFIED', fromRelease: { commitSha: 'c'.repeat(40) }, toRelease: { commitSha: 'd'.repeat(40) } }],
      }),
      null,
      false,
    );
    assert.match(text, /\*\*Manual rollback\*\* \(2026-11-12 09:00 UTC\): Rolled back by someone/);
    assert.match(text, /explained by Gemini:\*\* The new release exits on start\./);
    assert.match(text, /Rolled back from `ccccccc` to `ddddddd` \(by hand, from the release list\), verified/);
  });
});

describe('manual rollback (FR-60, FR-61)', () => {
  const rel = (id, extra) => ({ id, commitSha: `${id}xxxxxxxx`, imageRef: `kairo/demo:${id}`, source: 'PREVIEW', status: 'SUPERSEDED', healthyAt: at, deployedAt: at, ...extra });
  const active = rel('r3', { status: 'ACTIVE', deployedAt: new Date(at.getTime() + 2000) });
  const older = rel('r2', { deployedAt: new Date(at.getTime() + 1000) });
  const app = { slug: 'demo', releases: [active, older] };

  it('offers earlier healthy releases whose image is stored', () => {
    assert.equal(rollbackBlocked(app, older), null);
  });

  it('refuses the running release, unhealthy ones, Break It and pruned images', () => {
    assert.match(rollbackBlocked(app, active), /running now/);
    assert.match(rollbackBlocked(app, { ...older, imageRef: active.imageRef }), /same image/);
    assert.match(rollbackBlocked(app, { ...older, healthyAt: null }), /marked healthy/);
    assert.match(rollbackBlocked(app, { ...older, source: 'TEST' }), /marked healthy/);
    const many = { slug: 'demo', releases: [active, older, rel('r1', { deployedAt: new Date(at.getTime() - 3000) }), rel('r0', { deployedAt: new Date(at.getTime() - 4000) })] };
    assert.match(rollbackBlocked(many, many.releases[3]), /pruned/);
  });

  it('waits for a rollout, a grace window or another check to end', () => {
    beginRollout('demo');
    assert.match(rollbackBlocked(app, older), /rollout/);
    endRollout('demo');
    startGrace(active, { id: 'a1', slug: 'demo', namespace: 'kairo-demo' }, Date.now(), new Date());
    assert.match(rollbackBlocked(app, older), /grace window/);
    _resetGrace();
    state.claimAction('demo', 'RESTART');
    assert.match(rollbackBlocked(app, older), /still checking/);
  });

  it('is allowed while the app needs attention and with auto-heal off', async () => {
    const restore = prisma.app.updateMany;
    prisma.app.updateMany = async () => ({ count: 1 });
    const dry = env.remediationDryRun;
    env.remediationDryRun = true; // stops in the executor, before the cluster
    try {
      state.setHealthState('demo', 'NEEDS_ATTENTION', 'gave up');
      state.setAutoHealState('demo', false);
      const auto = await heal({ id: 'a1', slug: 'demo', namespace: 'kairo-demo' }, 'ROLLBACK', {});
      assert.equal(auto.note, 'the app needs attention: Kairo stopped acting on it');
      const manual = await heal({ id: 'a1', slug: 'demo', namespace: 'kairo-demo' }, 'ROLLBACK', { toReleaseId: 'r2' }, 'MANUAL');
      assert.equal(manual.attempt.trigger, 'MANUAL');
      assert.equal(manual.note, 'dry run'); // got past the gates
      assert.equal(state.recentAttempts('demo'), 0);
    } finally {
      env.remediationDryRun = dry;
      prisma.app.updateMany = restore;
    }
  });
});
