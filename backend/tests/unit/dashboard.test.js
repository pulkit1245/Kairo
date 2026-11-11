import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toIncidentDto } from '../../src/models/dto.mapper.js';
import { parseLogLine } from '../../src/services/logs.service.js';
import { appQueries } from '../../src/services/metrics.service.js';

describe('app metrics queries (FR-57)', () => {
  const q = appQueries({ namespace: 'kairo-todo', slug: 'todo' });

  it('scopes every query to the app', () => {
    for (const [name, expr] of Object.entries(q)) {
      assert.match(expr, /kairo-todo/, name);
    }
  });

  it('matches the Traefik service the way the alert rules do', () => {
    assert.match(q.rps, /service=~"kairo-todo-todo-\.\*"/);
  });

  it('gives an error rate of 0, not nothing, when there are no 5xx answers', () => {
    assert.match(q.errorRate, /or vector\(0\)/);
  });
});

describe('log lines (FR-58)', () => {
  it('splits the Kubernetes timestamp from the text', () => {
    assert.deepEqual(parseLogLine('2026-11-11T07:37:44.817787208Z GET / 200'), {
      time: '2026-11-11T07:37:44.817787208Z',
      text: 'GET / 200',
    });
  });

  it('keeps a line without a timestamp whole', () => {
    assert.deepEqual(parseLogLine('  at Object.<anonymous>'), { time: null, text: '  at Object.<anonymous>' });
  });
});

describe('incident attempts', () => {
  const row = {
    id: 'i1',
    appId: 'a1',
    app: { slug: 'todo' },
    alertName: 'KairoCrashLoop',
    pod: 'todo-1',
    cause: 'x',
    status: 'OPEN',
    explanation: null,
    startedAt: new Date('2026-11-11T10:00:00Z'),
    resolvedAt: null,
    recoverySeconds: null,
    githubIssueNumber: null,
  };

  it("carries a rollback's commits", () => {
    const attempt = {
      id: 't1',
      action: 'ROLLBACK',
      trigger: 'AUTO',
      dryRun: false,
      result: 'VERIFIED',
      fromReleaseId: 'r2',
      toReleaseId: 'r1',
      fromRelease: { commitSha: 'bbbbbbb' },
      toRelease: { commitSha: 'aaaaaaa' },
      attemptedAt: new Date('2026-11-11T10:00:05Z'),
      verifiedAt: new Date('2026-11-11T10:00:09Z'),
    };
    const [a] = toIncidentDto({ ...row, attempts: [attempt] }).attempts;
    assert.equal(a.fromSha, 'bbbbbbb');
    assert.equal(a.toSha, 'aaaaaaa');
  });

  it('has null commits when the releases were not loaded', () => {
    const attempt = { id: 't1', action: 'RESTART', trigger: 'AUTO', dryRun: false, result: 'APPLIED', attemptedAt: new Date(), verifiedAt: null };
    const [a] = toIncidentDto({ ...row, attempts: [attempt] }).attempts;
    assert.equal(a.fromSha, null);
    assert.equal(a.toSha, null);
  });
});
