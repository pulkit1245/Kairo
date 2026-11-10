import { render } from './renderer.service.js';

// Small on purpose. The memory limit is what lets us demo an OOMKill ->
// restart, and Docker Desktop on a laptop doesn't have much to give anyway.
const RESOURCES = {
  cpuRequest: '100m',
  cpuLimit: '500m',
  memoryRequest: '128Mi',
  memoryLimit: '256Mi',
};

const DOCKERFILE_TEMPLATE = {
  NODE: 'docker/node.Dockerfile.njk',
  PYTHON: 'docker/python.Dockerfile.njk',
};

// input: { pipelineRunId, appName, commitSha, namespace, detected }
// where `detected` is whatever detectStack() returned.
// returns a list of { kind, origin, path, content } - see GeneratedConfig in src/types
export function generateConfigs(input) {
  const { detected } = input;

  const ctx = {
    pipelineRunId: input.pipelineRunId,
    appName: input.appName,
    namespace: input.namespace,
    // built with Docker Desktop's engine in phase 2; its kubeadm cluster uses local images, so no registry
    image: `kairo/${input.appName}:${input.commitSha.slice(0, 7)}`,
    port: detected.port,
    startCommand: detected.startCommand,
    healthPath: '/',
    replicas: 1,
    ...RESOURCES,
  };

  // TODO: ingress + alert rules (P1), workflow (P2)
  return [
    file('DOCKERFILE', 'Dockerfile', render(DOCKERFILE_TEMPLATE[detected.stack], ctx)),
    file('DEPLOYMENT', 'k8s/deployment.yaml', render('k8s/deployment.yaml.njk', ctx)),
    file('SERVICE', 'k8s/service.yaml', render('k8s/service.yaml.njk', ctx)),
  ];
}

// everything is GENERATED until P2 learns to keep an existing Dockerfile (FR-25)
function file(kind, path, content) {
  return { kind, origin: 'GENERATED', path, content };
}
