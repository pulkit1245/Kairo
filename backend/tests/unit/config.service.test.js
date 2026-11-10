import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadAllYaml } from '@kubernetes/client-node';
import { generateConfigs, RESOURCES } from '../../src/generator/template/config.service.js';
import { validateConfigs } from '../../src/generator/template/validate.service.js';
import { ALERT_NAMES, FILE_KINDS } from '../../src/types/index.js';

const base = {
  pipelineRunId: 'cm123abc',
  appName: 'hello-node',
  commitSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  namespace: 'kairo-hello-node',
};

const node = { stack: 'NODE', port: 3000, startCommand: ['npm', 'start'] };

function nodeConfigs() {
  return generateConfigs({ ...base, detected: node });
}

function yaml(path) {
  const found = nodeConfigs().find((c) => c.path === path);
  assert.ok(found, `${path} was not generated`);
  return loadAllYaml(found.content)[0];
}

// what validateConfigs needs to know, same as generateConfigs builds
const ctx = {
  appName: base.appName,
  namespace: base.namespace,
  host: 'hello-node.kairo.local',
  image: `kairo/hello-node:${base.commitSha}`,
  port: 3000,
  ...RESOURCES,
};

describe('generateConfigs', () => {
  it('generates the Dockerfile, deployment, service, ingress and alert rules', () => {
    assert.deepEqual(
      nodeConfigs().map((c) => [c.kind, c.path, c.origin]),
      [
        ['DOCKERFILE', 'Dockerfile', 'GENERATED'],
        ['DEPLOYMENT', 'k8s/deployment.yaml', 'GENERATED'],
        ['SERVICE', 'k8s/service.yaml', 'GENERATED'],
        ['INGRESS', 'k8s/ingress.yaml', 'GENERATED'],
        ['ALERT_RULES', 'k8s/alert-rules.yml', 'GENERATED'],
      ],
    );
  });

  it('only uses file kinds from the shared enum', () => {
    for (const c of nodeConfigs()) assert.ok(FILE_KINDS.includes(c.kind), c.kind);
  });

  it('writes CMD in exec form', () => {
    const dockerfile = nodeConfigs().find((c) => c.kind === 'DOCKERFILE').content;
    assert.match(dockerfile, /^CMD \["npm","start"\]$/m);
  });

  // this is the contract remediation/ depends on
  it('deployment has probes, limits, PORT and the full-sha image in the app namespace', () => {
    const doc = yaml('k8s/deployment.yaml');
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
    assert.equal(yaml('k8s/service.yaml').spec.type, 'ClusterIP');
  });

  it('ingress routes <slug>.kairo.local to the service through Traefik', () => {
    const doc = yaml('k8s/ingress.yaml');
    assert.equal(doc.spec.ingressClassName, 'traefik');
    assert.equal(doc.spec.rules[0].host, 'hello-node.kairo.local');
    assert.equal(doc.spec.rules[0].http.paths[0].backend.service.name, 'hello-node');
  });

  it('alert rules have the five fixed names, the app label and the namespace filter', () => {
    const rules = yaml('k8s/alert-rules.yml').groups[0].rules;
    assert.deepEqual(rules.map((r) => r.alert), [...ALERT_NAMES]);
    for (const r of rules) {
      assert.equal(r.labels.app, 'hello-node', r.alert);
      assert.match(r.expr, /kairo-hello-node/, r.alert);
    }
  });

  it('uses the python Dockerfile for python apps', () => {
    const configs = generateConfigs({
      ...base,
      detected: { stack: 'PYTHON', port: 8000, startCommand: ['python', 'app.py'] },
    });
    assert.match(configs[0].content, /FROM python:/);
  });
});

describe('validateConfigs (FR-26)', () => {
  const swap = (kind, from, to) =>
    nodeConfigs().map((f) => (f.kind === kind ? { ...f, content: f.content.replace(from, to) } : f));

  it('accepts what the templates render', () => {
    assert.doesNotThrow(() => validateConfigs(nodeConfigs(), ctx));
  });

  it('rejects a deployment without a liveness probe', () => {
    assert.throws(
      () => validateConfigs(swap('DEPLOYMENT', 'livenessProbe:', 'notAProbe:'), ctx),
      /liveness probe missing/,
    );
  });

  it('rejects broken YAML', () => {
    assert.throws(() => validateConfigs(swap('SERVICE', 'kind: Service', 'kind: [Service'), ctx), /not valid YAML/);
  });

  it('rejects alert rules with a renamed alert', () => {
    assert.throws(
      () => validateConfigs(swap('ALERT_RULES', 'KairoCrashLoop', 'KairoCrash'), ctx),
      /alerts should be exactly/,
    );
  });

  it('rejects a NodePort service', () => {
    assert.throws(() => validateConfigs(swap('SERVICE', 'ClusterIP', 'NodePort'), ctx), /ClusterIP/);
  });
});
