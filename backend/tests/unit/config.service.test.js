import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadAllYaml } from '@kubernetes/client-node';
import { configContext, generateConfigs, WORKFLOW_PATH } from '../../src/generator/template/config.service.js';
import { validateConfigs } from '../../src/generator/template/validate.service.js';
import { ALERT_NAMES, FILE_KINDS } from '../../src/types/index.js';

const base = {
  pipelineRunId: 'cm123abc',
  appName: 'hello-node',
  commitSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  namespace: 'kairo-hello-node',
  repoFullName: 'PunitXd/Hello-Node',
  defaultBranch: 'main',
};

// what detectStack() returns for a plain npm app with a real test script
const nodeApp = (node = {}) => ({
  stack: 'NODE',
  port: 3000,
  startCommand: ['npm', 'start'],
  existingDockerfile: null,
  python: null,
  facts: { stack: { value: 'Node.js', source: 'rule', from: 'package.json' } },
  assumptions: ['The app listens on $PORT (3000) on 0.0.0.0.'],
  node: {
    version: 22,
    packageManager: 'npm',
    corepack: false,
    installCommand: 'npm ci --omit=dev',
    ciInstallCommand: 'npm ci',
    buildCommand: null,
    pruneCommand: null,
    testCommand: 'npm test',
    ...node,
  },
});

const input = (detected = nodeApp()) => ({ ...base, detected });
const render = (detected) => generateConfigs(input(detected));
const find = (files, kind) => files.find((f) => f.kind === kind);
const yaml = (files, kind) => loadAllYaml(find(files, kind).content)[0];

describe('generateConfigs', () => {
  it('generates the Dockerfile, k8s files, workflow and alert rules', () => {
    assert.deepEqual(
      render(nodeApp()).map((c) => [c.kind, c.path, c.origin]),
      [
        ['DOCKERFILE', 'Dockerfile', 'GENERATED'],
        ['DEPLOYMENT', 'k8s/deployment.yaml', 'GENERATED'],
        ['SERVICE', 'k8s/service.yaml', 'GENERATED'],
        ['INGRESS', 'k8s/ingress.yaml', 'GENERATED'],
        ['WORKFLOW', '.github/workflows/kairo.yml', 'GENERATED'],
        ['ALERT_RULES', 'k8s/alert-rules.yml', 'GENERATED'],
      ],
    );
  });

  it('only uses file kinds from the shared enum', () => {
    for (const c of render(nodeApp())) assert.ok(FILE_KINDS.includes(c.kind), c.kind);
  });

  it('keeps the facts and assumptions on the Dockerfile row (FR-15)', () => {
    const d = find(render(nodeApp()), 'DOCKERFILE');
    assert.equal(d.facts.facts.stack.from, 'package.json');
    assert.equal(d.facts.assumptions.length, 1);
  });

  // this is the contract remediation/ depends on
  it('deployment has probes, limits, PORT and the full-sha image in the app namespace', () => {
    const doc = yaml(render(nodeApp()), 'DEPLOYMENT');
    const container = doc.spec.template.spec.containers[0];
    assert.equal(doc.metadata.name, 'hello-node');
    assert.equal(doc.metadata.namespace, 'kairo-hello-node');
    assert.equal(doc.metadata.annotations['kairo.dev/pipeline-run-id'], 'cm123abc');
    assert.ok(container.livenessProbe.httpGet);
    assert.equal(container.resources.limits.memory, '256Mi');
    assert.equal(container.resources.limits.cpu, '500m');
    assert.equal(container.image, `kairo/hello-node:${base.commitSha}`);
    // loadAllYaml returns typed objects (V1EnvVar), so compare plain fields
    assert.deepEqual(container.env.map(({ name, value }) => ({ name, value })), [{ name: 'PORT', value: '3000' }]);
  });

  it('service is ClusterIP: outside traffic only comes through Traefik', () => {
    assert.equal(yaml(render(nodeApp()), 'SERVICE').spec.type, 'ClusterIP');
  });

  it('ingress routes <slug>.kairo.local to the service through Traefik', () => {
    const doc = yaml(render(nodeApp()), 'INGRESS');
    assert.equal(doc.spec.ingressClassName, 'traefik');
    assert.equal(doc.spec.rules[0].host, 'hello-node.kairo.local');
    assert.equal(doc.spec.rules[0].http.paths[0].backend.service.name, 'hello-node');
  });

  it('alert rules have the five fixed names, the app label and the namespace filter', () => {
    const rules = yaml(render(nodeApp()), 'ALERT_RULES').groups[0].rules;
    assert.deepEqual(rules.map((r) => r.alert), [...ALERT_NAMES]);
    for (const r of rules) {
      assert.equal(r.labels.app, 'hello-node', r.alert);
      assert.match(r.expr, /kairo-hello-node/, r.alert);
    }
  });
});

describe('Node Dockerfile (FR-12, M5, M6)', () => {
  it('uses the detected Node version and writes CMD in exec form', () => {
    const d = find(render(nodeApp({ version: 20 })), 'DOCKERFILE').content;
    assert.match(d, /^FROM node:20-slim$/m);
    assert.match(d, /^CMD \["npm","start"\]$/m);
  });

  it('installs production dependencies only when there is no build', () => {
    const d = find(render(nodeApp()), 'DOCKERFILE').content;
    assert.match(d, /^RUN npm ci --omit=dev$/m);
    assert.doesNotMatch(d, /run build/);
  });

  it('builds with dev dependencies, then prunes them', () => {
    const d = find(render(nodeApp({ installCommand: 'npm ci', buildCommand: 'npm run build', pruneCommand: 'npm prune --omit=dev' })), 'DOCKERFILE').content;
    const order = ['RUN npm ci', 'RUN npm run build', 'RUN npm prune --omit=dev', 'ENV NODE_ENV=production'].map((l) => d.indexOf(l));
    assert.ok(order.every((i) => i >= 0), d);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  it('enables corepack for pnpm', () => {
    const d = find(render(nodeApp({ packageManager: 'pnpm', corepack: true, installCommand: 'pnpm install --frozen-lockfile --prod' })), 'DOCKERFILE').content;
    assert.match(d, /^RUN corepack enable$/m);
    assert.match(d, /^RUN pnpm install --frozen-lockfile --prod$/m);
  });

  it('uses the python Dockerfile for python apps', () => {
    const configs = render({
      stack: 'PYTHON', port: 8000, startCommand: ['python', 'app.py'], existingDockerfile: null,
      node: null, python: { version: '3.12' }, facts: {}, assumptions: [],
    });
    assert.match(find(configs, 'DOCKERFILE').content, /FROM python:3\.12-slim/);
    assert.equal(yaml(configs, 'WORKFLOW').jobs.test, undefined);
  });
});

describe('existing Dockerfile (FR-11, FR-25)', () => {
  const kept = { ...nodeApp(), existingDockerfile: 'FROM busybox:1.36\nCMD httpd -f -p $PORT\n' };

  it('is kept untouched and marked KEPT_EXISTING', () => {
    const d = find(render(kept), 'DOCKERFILE');
    assert.equal(d.origin, 'KEPT_EXISTING');
    assert.equal(d.content, kept.existingDockerfile);
  });

  it('still gets the other files, including the workflow', () => {
    const files = render(kept);
    assert.equal(files.length, 6);
    assert.ok(find(files, 'WORKFLOW'));
  });

  it("isn't checked like a generated one (shell-form CMD is the owner's call)", () => {
    assert.doesNotThrow(() => render(kept));
  });
});

describe('workflow (FR-24)', () => {
  const wf = (detected = nodeApp()) => yaml(render(detected), 'WORKFLOW');

  it('runs on push to the default branch and can push packages', () => {
    const doc = wf();
    assert.deepEqual(doc.on.push.branches, ['main']);
    assert.equal(doc.permissions.packages, 'write');
  });

  it('pushes ghcr.io/<lower-case owner/repo>:<full sha> for amd64 and arm64', () => {
    const doc = wf();
    assert.equal(doc.env.IMAGE, 'ghcr.io/punitxd/hello-node');
    const build = doc.jobs.image.steps.find((s) => s.uses?.startsWith('docker/build-push-action@'));
    assert.equal(build.with.platforms, 'linux/amd64,linux/arm64');
    assert.equal(build.with.tags, '${{ env.IMAGE }}:${{ github.sha }}');
    assert.equal(build.with.labels, 'org.opencontainers.image.source=https://github.com/PunitXd/Hello-Node');
  });

  it('runs real tests first, and skips the test job without one (FR-13)', () => {
    assert.equal(wf().jobs.image.needs, 'test');
    assert.equal(wf().jobs.test.steps.at(-1).run, 'npm test');
    const noTests = wf(nodeApp({ testCommand: null }));
    assert.equal(noTests.jobs.test, undefined);
    assert.equal(noTests.jobs.image.needs, undefined);
  });

  it('pins every action to a commit SHA and runs Trivy report-only', () => {
    const doc = wf();
    const steps = Object.values(doc.jobs).flatMap((j) => j.steps);
    for (const s of steps.filter((s) => s.uses)) assert.match(s.uses, /@[0-9a-f]{40}$/, s.uses);
    const trivy = steps.find((s) => /aquasec\/trivy@sha256:/.test(s.run ?? ''));
    assert.match(trivy.run, /--exit-code 0/);
  });

  it('is named so the PR adds it next to, not over, other workflows', () => {
    assert.equal(WORKFLOW_PATH, '.github/workflows/kairo.yml');
  });
});

describe('validateConfigs (FR-26)', () => {
  const ctx = configContext(input());
  const swap = (kind, from, to) =>
    render(nodeApp()).map((f) => (f.kind === kind ? { ...f, content: f.content.replace(from, to) } : f));

  it('accepts what the templates render', () => {
    assert.doesNotThrow(() => validateConfigs(render(nodeApp()), ctx));
  });

  it('rejects a deployment without a liveness probe', () => {
    assert.throws(() => validateConfigs(swap('DEPLOYMENT', 'livenessProbe:', 'notAProbe:'), ctx), /liveness probe missing/);
  });

  it('rejects broken YAML', () => {
    assert.throws(() => validateConfigs(swap('SERVICE', 'kind: Service', 'kind: [Service'), ctx), /not valid YAML/);
  });

  it('rejects alert rules with a renamed alert', () => {
    assert.throws(() => validateConfigs(swap('ALERT_RULES', 'KairoCrashLoop', 'KairoCrash'), ctx), /alerts should be exactly/);
  });

  it('rejects a NodePort service', () => {
    assert.throws(() => validateConfigs(swap('SERVICE', 'ClusterIP', 'NodePort'), ctx), /ClusterIP/);
  });

  it('rejects a workflow that builds one architecture or uses a movable tag', () => {
    assert.throws(() => validateConfigs(swap('WORKFLOW', 'linux/amd64,linux/arm64', 'linux/amd64'), ctx), /linux\/arm64/);
    assert.throws(
      () => validateConfigs(swap('WORKFLOW', /docker\/login-action@[0-9a-f]{40}/, 'docker/login-action@v3'), ctx),
      /pinned to a commit SHA/,
    );
  });

  it('rejects a workflow whose Trivy step can fail the build', () => {
    assert.throws(() => validateConfigs(swap('WORKFLOW', '--exit-code 0', '--exit-code 1'), ctx), /report-only/);
  });
});
