import { appHost, appImage, ghcrImage } from '../../utils/appNames.js';
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

export const WORKFLOW_PATH = '.github/workflows/kairo.yml';

// input: { pipelineRunId, appName (the slug), commitSha, namespace,
//          repoFullName, defaultBranch, detected }
// where `detected` is what detectStack() returned.
// Returns [{ kind, origin, path, content, facts? }] (GeneratedConfig in src/types),
// after checking every file (FR-26). A bad file throws an AppError, which ends
// the run at GENERATING. The Dockerfile row carries the facts and assumptions
// (FR-15), for the onboarding view and the PR.
export function generateConfigs(input) {
  const { detected } = input;
  const ctx = configContext(input);

  // FR-11, FR-25: a Dockerfile in the repo is kept untouched
  const dockerfile = detected.existingDockerfile
    ? { kind: 'DOCKERFILE', origin: 'KEPT_EXISTING', path: 'Dockerfile', content: detected.existingDockerfile }
    : file('DOCKERFILE', 'Dockerfile', render(DOCKERFILE_TEMPLATE[detected.stack], ctx));
  dockerfile.facts = { facts: detected.facts, assumptions: detected.assumptions };

  const files = [
    dockerfile,
    file('DEPLOYMENT', 'k8s/deployment.yaml', render('k8s/deployment.yaml.njk', ctx)),
    file('SERVICE', 'k8s/service.yaml', render('k8s/service.yaml.njk', ctx)),
    file('INGRESS', 'k8s/ingress.yaml', render('k8s/ingress.yaml.njk', ctx)),
    file('WORKFLOW', WORKFLOW_PATH, render('ci/kairo.yml.njk', ctx.workflow)),
    file('ALERT_RULES', 'k8s/alert-rules.yml', render('prometheus/alert-rules.yml.njk', ctx)),
  ];

  validateConfigs(files, ctx);
  return files;
}

// What the templates and the FR-26 checks both read. Exported for the tests.
export function configContext(input) {
  const { detected } = input;
  return {
    pipelineRunId: input.pipelineRunId,
    appName: input.appName,
    namespace: input.namespace,
    host: appHost(input.appName),
    image: appImage(input.appName, input.commitSha),
    port: detected.port,
    startCommand: detected.startCommand,
    node: detected.node,
    python: detected.python,
    healthPath: '/',
    replicas: 1,
    ...RESOURCES,
    workflow: {
      // GitHub's own ${{ ... }} expressions, which Nunjucks would otherwise read as its own
      gh: (expr) => `\${{ ${expr} }}`,
      image: ghcrImage(input.repoFullName),
      repoFullName: input.repoFullName,
      defaultBranch: input.defaultBranch,
      dockerfile: null,
      // tests run only if they're real (FR-13, FR-24); Node only until P4
      test: detected.node?.testCommand
        ? {
            nodeVersion: detected.node.version,
            corepack: detected.node.corepack,
            installCommand: detected.node.ciInstallCommand,
            testCommand: detected.node.testCommand,
          }
        : null,
    },
  };
}

function file(kind, path, content) {
  return { kind, origin: 'GENERATED', path, content };
}
