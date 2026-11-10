import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadAllYaml } from '@kubernetes/client-node';
import { generateConfigs } from '../../src/generator/template/config.service.js';
import { PR_MARKER, prBody, repoCopy, SETUP_BRANCH } from '../../src/generator/pr/pr.body.js';

const files = (dockerfileOrigin = 'GENERATED') => [
  { kind: 'DOCKERFILE', origin: dockerfileOrigin, path: 'Dockerfile' },
  { kind: 'DEPLOYMENT', origin: 'GENERATED', path: 'k8s/deployment.yaml' },
  { kind: 'SERVICE', origin: 'GENERATED', path: 'k8s/service.yaml' },
  { kind: 'INGRESS', origin: 'GENERATED', path: 'k8s/ingress.yaml' },
  { kind: 'WORKFLOW', origin: 'GENERATED', path: '.github/workflows/kairo.yml' },
  { kind: 'ALERT_RULES', origin: 'GENERATED', path: 'k8s/alert-rules.yml' },
];

const body = (over = {}) =>
  prBody({
    repoFullName: 'PunitXd/kairo-node-sample',
    defaultBranch: 'main',
    commitSha: '2c7e8d5d36e22ae7a49155b3631b14babab2a05d',
    image: 'ghcr.io/punitxd/kairo-node-sample',
    files: files(),
    facts: {
      stack: { value: 'Node.js', source: 'rule', from: 'package.json' },
      packageManager: { value: 'npm', source: 'default', from: 'no lockfile' },
      port: { value: 3000, source: 'default', from: 'injected as $PORT (FR-16)' },
    },
    assumptions: ['The app listens on $PORT (3000) on 0.0.0.0.'],
    graceSeconds: 60,
    ...over,
  });

describe('setup PR body (FR-32)', () => {
  it('lists every fact with its value and source', () => {
    const b = body();
    assert.match(b, /\| Stack \| `Node\.js` \| rule: package\.json \|/);
    assert.match(b, /\| Package manager \| `npm` \| default: no lockfile \|/);
    assert.match(b, /\| Port \| `3000` \| default: injected as \$PORT \(FR-16\) \|/);
  });

  it('lists the assumptions, the files and that Trivy is report-only', () => {
    const b = body();
    assert.match(b, /### Assumptions\n\n- The app listens on \$PORT/);
    for (const f of files()) assert.ok(b.includes(`| \`${f.path}\` |`), f.path);
    assert.match(b, /\*\*Trivy is report-only\.\*\*/);
    assert.ok(b.endsWith(PR_MARKER));
  });

  it('says a kept Dockerfile is kept and leaves it out of the file list (FR-25)', () => {
    const b = body({ files: files('KEPT_EXISTING') });
    assert.match(b, /\*\*Kept as they are:\*\* `Dockerfile`\. The repo already had it/);
    assert.ok(!b.includes('| `Dockerfile` |'));
  });

  it('names the preview sha and the grace window', () => {
    assert.match(body(), /preview of `2c7e8d5` and it stayed healthy through its 60 s grace window/);
  });

  it('lists facts in a fixed order, whatever order the database returns', () => {
    const b = body({
      facts: {
        port: { value: 3000, source: 'default', from: 'x' },
        stack: { value: 'Node.js', source: 'rule', from: 'package.json' },
        packageManager: { value: 'npm', source: 'rule', from: 'package-lock.json' },
      },
    });
    assert.ok(b.indexOf('| Stack |') < b.indexOf('| Package manager |'));
    assert.ok(b.indexOf('| Package manager |') < b.indexOf('| Port |'));
  });

  it('uses the fixed branch name', () => {
    assert.equal(SETUP_BRANCH, 'kairo/setup');
  });
});

describe("the repo's copy of the files", () => {
  const render = (runId) =>
    generateConfigs({
      pipelineRunId: runId, appName: 'demo', commitSha: 'a'.repeat(40), namespace: 'kairo-demo',
      repoFullName: 'PunitXd/demo', defaultBranch: 'main',
      detected: {
        stack: 'NODE', port: 3000, startCommand: ['npm', 'start'], existingDockerfile: null, python: null, facts: {}, assumptions: [],
        node: { version: 22, packageManager: 'npm', corepack: false, installCommand: 'npm ci --omit=dev', ciInstallCommand: 'npm ci', buildCommand: null, pruneCommand: null, testCommand: null },
      },
    });

  it('drops the run id from the Deployment, so re-runs of the same commit change nothing', () => {
    const a = render('run1').map(repoCopy);
    const b = render('run2').map(repoCopy);
    assert.deepEqual(a, b);
    const deployment = render('run1').find((f) => f.kind === 'DEPLOYMENT');
    const doc = loadAllYaml(repoCopy(deployment))[0];
    assert.equal(doc.metadata.annotations, undefined);
    assert.equal(doc.metadata.name, 'demo');
    assert.ok(deployment.content.includes('kairo.dev/pipeline-run-id'), 'the cluster copy keeps it');
  });
});
