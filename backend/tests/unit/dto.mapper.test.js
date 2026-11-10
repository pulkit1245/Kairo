import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recoverySeconds, toDeploymentDto, toIncidentDto } from '../../src/models/dto.mapper.js';

const app = { id: 'app1', slug: 'hello-node', repoFullName: 'alice/hello-node', stack: 'NODE' };

const run = {
  id: 'run1',
  appId: 'app1',
  app,
  status: 'FAILED',
  failedStep: 'DETECTING',
  commitSha: 'abc',
  errorLog: 'Unsupported project',
  explanation: null,
  startedAt: new Date('2026-11-10T10:00:00Z'),
  finishedAt: new Date('2026-11-10T10:00:05Z'),
};

describe('toDeploymentDto', () => {
  it('maps a pipeline run and its app to the phase-1 deployment shape', () => {
    const dto = toDeploymentDto(run);
    assert.equal(dto.id, 'run1');
    assert.equal(dto.appName, 'hello-node');
    assert.equal(dto.repoUrl, 'https://github.com/alice/hello-node.git');
    assert.equal(dto.stack, 'NODE');
    assert.equal(dto.failedStep, 'DETECTING');
    assert.equal(dto.failureReason, 'Unsupported project');
    assert.equal(dto.finishedAt, '2026-11-10T10:00:05.000Z');
    // the list view doesn't load files, so no configs key at all
    assert.equal('configs' in dto, false);
  });

  it('returns configs in file-kind order on the detail view', () => {
    const files = [
      { kind: 'SERVICE', origin: 'GENERATED', path: 'k8s/service.yaml', content: 's' },
      { kind: 'DOCKERFILE', origin: 'GENERATED', path: 'Dockerfile', content: 'd' },
    ];
    const dto = toDeploymentDto({ ...run, files });
    assert.deepEqual(dto.configs.map((c) => c.kind), ['DOCKERFILE', 'SERVICE']);
  });

  it('keeps finishedAt null while running', () => {
    assert.equal(toDeploymentDto({ ...run, finishedAt: null }).finishedAt, null);
  });
});

describe('toIncidentDto', () => {
  it('includes the app slug and the attempts, oldest first', () => {
    const at = (s) => new Date(`2026-11-10T10:00:${s}Z`);
    const dto = toIncidentDto({
      id: 'inc1',
      appId: 'app1',
      app,
      alertName: 'KairoOOMKilled',
      cause: 'Container went over its memory limit',
      status: 'RESOLVED',
      explanation: null,
      startedAt: at('00'),
      resolvedAt: at('42'),
      recoverySeconds: 42,
      githubIssueNumber: null,
      attempts: [
        { id: 'b', action: 'ROLLBACK', trigger: 'AUTO', dryRun: false, result: 'APPLIED', fromReleaseId: null, toReleaseId: null, attemptedAt: at('30'), verifiedAt: null },
        { id: 'a', action: 'RESTART', trigger: 'AUTO', dryRun: false, result: 'FAILED', fromReleaseId: null, toReleaseId: null, attemptedAt: at('01'), verifiedAt: null },
      ],
    });
    assert.equal(dto.appName, 'hello-node');
    assert.equal(dto.recoverySeconds, 42);
    assert.deepEqual(dto.attempts.map((a) => a.id), ['a', 'b']);
    assert.equal('action' in dto, false);
  });
});

describe('recoverySeconds', () => {
  it('rounds to one decimal and never goes negative', () => {
    const start = new Date('2026-11-10T10:00:00.000Z');
    assert.equal(recoverySeconds(start, new Date('2026-11-10T10:00:12.345Z')), 12.3);
    assert.equal(recoverySeconds(start, new Date('2026-11-10T09:59:59Z')), 0);
  });
});
