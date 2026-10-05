import { render } from './renderer.service.js';

// Small on purpose. The memory limit is what lets us demo an OOMKill ->
// restart, and minikube on a laptop doesn't have much to give anyway.
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

// input: { deploymentId, appName, commitSha, namespace, detected }
// where `detected` is whatever detectStack() returned.
// returns a list of { kind, path, content } - see GeneratedConfig in src/types
export function generateConfigs(input) {
  const { detected } = input;

  const ctx = {
    deploymentId: input.deploymentId,
    appName: input.appName,
    namespace: input.namespace,
    // built straight into minikube's docker daemon in phase 2, so no registry
    image: `kairo/${input.appName}:${input.commitSha.slice(0, 7)}`,
    port: detected.port,
    startCommand: detected.startCommand,
    healthPath: '/',
    replicas: 1,
    ...RESOURCES,
  };

  // TODO: ci workflow + prometheus rules templates (phase 2)
  return [
    {
      kind: 'dockerfile',
      path: 'Dockerfile',
      content: render(DOCKERFILE_TEMPLATE[detected.stack], ctx),
    },
    {
      kind: 'k8s',
      path: 'k8s/deployment.yaml',
      content: render('k8s/deployment.yaml.njk', ctx),
    },
    {
      kind: 'k8s',
      path: 'k8s/service.yaml',
      content: render('k8s/service.yaml.njk', ctx),
    },
  ];
}
