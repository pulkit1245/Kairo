import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadAllYaml } from '@kubernetes/client-node';
import { generateConfigs } from '../../src/generator/template/config.service.js';

const base = {
  deploymentId: 'cm123abc',
  appName: 'hello-node',
  commitSha: 'a1b2c3d4e5f6',
  namespace: 'kairo-apps',
};

function nodeConfigs() {
  return generateConfigs({
    ...base,
    detected: { stack: 'NODE', port: 3000, startCommand: ['npm', 'start'] },
  });
}

function file(path) {
  const found = nodeConfigs().find((c) => c.path === path);
  assert.ok(found, `${path} was not generated`);
  return found.content;
}

describe('generateConfigs', () => {
  it('generates a Dockerfile, deployment and service', () => {
    assert.deepEqual(
      nodeConfigs().map((c) => c.path),
      ['Dockerfile', 'k8s/deployment.yaml', 'k8s/service.yaml'],
    );
  });

  it('writes CMD in exec form', () => {
    assert.match(file('Dockerfile'), /^CMD \["npm","start"\]$/m);
  });

  // this is the contract remediation/ depends on
  it('deployment has a liveness probe and a memory limit', () => {
    const [doc] = loadAllYaml(file('k8s/deployment.yaml'));
    const container = doc?.spec?.template.spec?.containers[0];

    assert.equal(doc?.metadata?.name, 'hello-node');
    assert.ok(container?.livenessProbe?.httpGet, 'livenessProbe missing');
    assert.equal(container?.resources?.limits?.memory, '256Mi');
    assert.equal(container?.image, 'kairo/hello-node:a1b2c3d');
  });

  it('uses the python Dockerfile for python apps', () => {
    const configs = generateConfigs({
      ...base,
      detected: { stack: 'PYTHON', port: 8000, startCommand: ['python', 'app.py'] },
    });
    assert.match(configs[0].content, /FROM python:/);
  });
});
