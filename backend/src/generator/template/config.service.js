import { appHost, appImage } from '../../utils/appNames.js';
import { render } from './renderer.service.js';
import { validateConfigs } from './validate.service.js';

// FR-22. Small on purpose: the memory limit is what lets us demo an OOMKill ->
// restart, and Docker Desktop on a laptop doesn't have much to give anyway.
// The CPU limit stays (decided 7 Nov, M9); KairoHighCpu measures against it.
export const RESOURCES = {
  cpuRequest: '100m',
  cpuLimit: '500m',
  cpuLimitCores: 0.5,
  memoryRequest: '128Mi',
  memoryLimit: '256Mi',
};

const DOCKERFILE_TEMPLATE = {
  NODE: 'docker/node.Dockerfile.njk',
  PYTHON: 'docker/python.Dockerfile.njk',
};

// input: { pipelineRunId, appName (the slug), commitSha, namespace, detected }
// where `detected` is whatever detectStack() returned.
// Returns [{ kind, origin, path, content }] (GeneratedConfig in src/types), after
// checking every file (FR-26). A bad file throws an AppError, which ends the
// run at GENERATING.
export function generateConfigs(input) {
  const { detected } = input;

  const ctx = {
    pipelineRunId: input.pipelineRunId,
    appName: input.appName,
    namespace: input.namespace,
    host: appHost(input.appName),
    image: appImage(input.appName, input.commitSha),
    port: detected.port,
    startCommand: detected.startCommand,
    healthPath: '/',
    replicas: 1,
    ...RESOURCES,
  };

  // TODO(P2): workflow (FR-21)
  const files = [
    file('DOCKERFILE', 'Dockerfile', render(DOCKERFILE_TEMPLATE[detected.stack], ctx)),
    file('DEPLOYMENT', 'k8s/deployment.yaml', render('k8s/deployment.yaml.njk', ctx)),
    file('SERVICE', 'k8s/service.yaml', render('k8s/service.yaml.njk', ctx)),
    file('INGRESS', 'k8s/ingress.yaml', render('k8s/ingress.yaml.njk', ctx)),
    file('ALERT_RULES', 'k8s/alert-rules.yml', render('prometheus/alert-rules.yml.njk', ctx)),
  ];

  validateConfigs(files, ctx);
  return files;
}

// everything is GENERATED until P2 learns to keep an existing Dockerfile (FR-25)
function file(kind, path, content) {
  return { kind, origin: 'GENERATED', path, content };
}
