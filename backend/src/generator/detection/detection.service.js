import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../utils/AppError.js';

// Stack detection (FR-11 to FR-16). Rules only for now; Gemini fills facts the
// rules leave unknown in P4 (FR-17).
//
// Rule order (FR-11): an existing Dockerfile is kept, then package.json means
// Node, then requirements.txt means Python. A kept Dockerfile still reads the
// manifests, because the workflow's test step needs the Node facts.
//
// Every fact records where it came from (FR-15), shown in the onboarding view
// and the PR:
//   { value, source: 'rule' | 'default', from: 'package-lock.json' }

export const NODE_PORT = 3000;
export const PYTHON_PORT = 8000;
export const DEFAULT_NODE_VERSION = 22;
// majors with an official node:<n>-alpine image Kairo will use
export const NODE_VERSIONS = [18, 20, 22, 24];
const PYTHON_VERSION = '3.12';
const PYTHON_ENTRYPOINTS = ['main.py', 'app.py', 'server.py'];
const NODE_ENTRYPOINTS = ['index.js', 'server.js'];

// what `npm init` writes; it isn't a real test script (FR-13)
const NPM_PLACEHOLDER_TEST = /no test specified/;

const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

const rule = (value, from) => ({ value, source: 'rule', from });
const byDefault = (value, from) => ({ value, source: 'default', from });

/**
 * @returns {Promise<{
 *   stack: 'NODE'|'PYTHON'|null,
 *   port: number,
 *   startCommand: string[]|null,
 *   existingDockerfile: string|null,
 *   node: null | { version: number, packageManager: 'npm'|'yarn'|'pnpm', corepack: boolean,
 *                  installCommand: string, ciInstallCommand: string, buildCommand: string|null,
 *                  pruneCommand: string|null, testCommand: string|null },
 *   python: null | { version: string },
 *   facts: Record<string, { value: any, source: 'rule'|'default', from: string }>,
 *   assumptions: string[],
 * }>}
 */
export async function detectStack(dir) {
  const has = (f) => exists(dir, f);
  const facts = {};
  const assumptions = [];

  let existingDockerfile = null;
  if (await has('Dockerfile')) {
    existingDockerfile = await readFile(path.join(dir, 'Dockerfile'), 'utf8');
    facts.dockerfile = rule('kept as it is', 'Dockerfile in the repo root');
  }

  const hasNode = await has('package.json');
  const hasPython = await has('requirements.txt');

  if (hasNode) {
    if (hasPython) {
      // PRD section 8: pick Node, record the guess, flag it in the PR
      assumptions.push('The repo has both package.json and requirements.txt; Kairo treated it as a Node.js app.');
    }
    const node = await detectNode(dir, facts, assumptions, { needStart: !existingDockerfile });
    return result('NODE', NODE_PORT, node.startCommand, { existingDockerfile, node: node.node, facts, assumptions });
  }

  if (hasPython) {
    const py = await detectPython(dir, facts, assumptions, { needStart: !existingDockerfile });
    return result('PYTHON', PYTHON_PORT, py.startCommand, { existingDockerfile, python: py.python, facts, assumptions });
  }

  if (existingDockerfile) {
    facts.stack = byDefault('unknown', 'no package.json or requirements.txt');
    facts.port = byDefault(NODE_PORT, 'injected as $PORT (FR-16)');
    assumptions.push(`The Dockerfile's app listens on $PORT (${NODE_PORT}) on 0.0.0.0; Kairo injects PORT and can't read it from the Dockerfile.`);
    return result(null, NODE_PORT, null, { existingDockerfile, facts, assumptions });
  }

  throw new AppError(
    'Unsupported stack: expected a Dockerfile, package.json (Node) or requirements.txt (Python) in the repo root',
  );
}

function result(stack, port, startCommand, rest) {
  return { stack, port, startCommand, existingDockerfile: null, node: null, python: null, ...rest };
}

async function detectNode(dir, facts, assumptions, { needStart }) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    throw new AppError('package.json exists but is not valid JSON');
  }
  facts.stack = rule('Node.js', 'package.json');

  // package manager from the lockfile (FR-12)
  let packageManager = 'npm';
  let lockfile = null;
  for (const [file, pm] of LOCKFILES) {
    if (await exists(dir, file)) {
      packageManager = pm;
      lockfile = file;
      break;
    }
  }
  facts.packageManager = lockfile ? rule(packageManager, lockfile) : byDefault('npm', 'no lockfile');

  // Yarn 2+ ("berry") and pnpm come through corepack; Yarn 1 ships in the node image
  const yarnBerry =
    packageManager === 'yarn' &&
    ((await exists(dir, '.yarnrc.yml')) || /^yarn@[2-9]/.test(String(pkg.packageManager ?? '')));
  const corepack = packageManager === 'pnpm' || yarnBerry;

  // Node version from engines.node (FR-12), default 22
  const version = nodeVersion(pkg.engines?.node);
  facts.nodeVersion =
    version.source === 'rule'
      ? rule(version.value, `engines.node "${pkg.engines.node}"`)
      : byDefault(version.value, version.why);
  if (version.note) assumptions.push(version.note);

  const scripts = pkg.scripts ?? {};
  const run = (name) => (packageManager === 'npm' ? `npm run ${name}` : `${packageManager} run ${name}`);

  // build script (FR-12)
  const buildCommand = scripts.build ? run('build') : null;
  facts.buildScript = buildCommand
    ? rule(buildCommand, 'scripts.build in package.json')
    : rule('none', 'no scripts.build in package.json');

  // a real test script only (FR-13)
  let testCommand = null;
  if (!scripts.test) facts.testScript = rule('none', 'no scripts.test in package.json');
  else if (NPM_PLACEHOLDER_TEST.test(scripts.test)) facts.testScript = rule('none', "scripts.test is npm's placeholder");
  else {
    testCommand = packageManager === 'npm' ? 'npm test' : `${packageManager} test`;
    facts.testScript = rule(testCommand, 'scripts.test in package.json');
  }

  // start command: scripts.start, then main, then index.js or server.js (FR-12)
  let startCommand = null;
  if (scripts.start) {
    startCommand = ['npm', 'start'];
    facts.startCommand = rule('npm start', 'scripts.start in package.json');
  } else if (pkg.main) {
    startCommand = ['node', pkg.main];
    facts.startCommand = rule(`node ${pkg.main}`, 'main in package.json');
  } else {
    for (const file of NODE_ENTRYPOINTS) {
      if (await exists(dir, file)) {
        startCommand = ['node', file];
        facts.startCommand = rule(`node ${file}`, `${file} in the repo root`);
        break;
      }
    }
  }
  if (!startCommand && needStart) {
    throw new AppError('Node project has no "start" script, no "main" field and no index.js or server.js');
  }

  facts.port = byDefault(NODE_PORT, 'injected as $PORT (FR-16)');
  assumptions.push(`The app listens on $PORT (${NODE_PORT}) on 0.0.0.0.`);

  const install = installCommands(packageManager, { lockfile, yarnBerry, withDev: Boolean(buildCommand) });
  if (buildCommand && packageManager === 'yarn') {
    assumptions.push("Yarn can't drop dev dependencies after a build, so they stay in the image.");
  }

  return {
    startCommand,
    node: {
      version: version.value,
      packageManager,
      corepack,
      installCommand: install.image,
      ciInstallCommand: install.ci,
      buildCommand,
      pruneCommand: buildCommand ? install.prune : null,
      testCommand,
    },
  };
}

// image: what the Dockerfile runs (production only unless a build needs dev
// dependencies). ci: what the workflow's test job runs (everything)
function installCommands(pm, { lockfile, yarnBerry, withDev }) {
  if (pm === 'pnpm') {
    return {
      image: withDev ? 'pnpm install --frozen-lockfile' : 'pnpm install --frozen-lockfile --prod',
      ci: 'pnpm install --frozen-lockfile',
      prune: 'pnpm prune --prod',
    };
  }
  if (pm === 'yarn') {
    const locked = yarnBerry ? 'yarn install --immutable' : 'yarn install --frozen-lockfile';
    return {
      image: withDev || yarnBerry ? locked : `${locked} --production`,
      ci: locked,
      prune: null,
    };
  }
  // npm ci needs a lockfile; plenty of student repos don't commit one
  const base = lockfile ? 'npm ci' : 'npm install';
  return { image: withDev ? base : `${base} --omit=dev`, ci: base, prune: 'npm prune --omit=dev' };
}

/**
 * engines.node -> a major with an image. Exported for the tests.
 * ">=18" picks 22 (it satisfies the range); "20.x", "^20.11" or "~20" pick 20;
 * "18 || 20" picks the newest listed; anything else falls back to 22.
 * @returns {{ value: number, source: 'rule'|'default', why?: string, note?: string }}
 */
export function nodeVersion(range) {
  if (!range || typeof range !== 'string' || !range.trim() || range.trim() === '*') {
    return { value: DEFAULT_NODE_VERSION, source: 'default', why: 'no engines.node in package.json' };
  }
  const r = range.trim();

  // only a lower bound: the default if it satisfies it, else the next image up
  const lower = /^>=?\s*v?(\d+)/.exec(r);
  if (lower && !r.includes('<') && !r.includes('||')) {
    const min = Number(lower[1]) + (r.startsWith('>=') ? 0 : 1);
    const pick = DEFAULT_NODE_VERSION >= min ? DEFAULT_NODE_VERSION : NODE_VERSIONS.find((v) => v >= min);
    if (pick) return { value: pick, source: 'rule' };
  }

  // each "||" alternative's leading major: "^20.11.0", "20.x", "~18", "v20", "20"
  const majors = r
    .split('||')
    .map((alt) => /^\s*[\^~=v]*\s*(\d+)(?:\.|x|\s|$)/.exec(alt)?.[1])
    .filter(Boolean)
    .map(Number)
    .filter((n) => NODE_VERSIONS.includes(n));
  if (majors.length) return { value: Math.max(...majors), source: 'rule' };

  return {
    value: DEFAULT_NODE_VERSION,
    source: 'default',
    why: `engines.node "${r}" has no version Kairo builds with`,
    note: `engines.node is "${r}"; Kairo used Node ${DEFAULT_NODE_VERSION}.`,
  };
}

// Python stays as in P1 until P4 adds frameworks (FR-14)
async function detectPython(dir, facts, assumptions, { needStart }) {
  facts.stack = rule('Python', 'requirements.txt');
  facts.pythonVersion = byDefault(PYTHON_VERSION, 'no version file read yet (P4)');
  let startCommand = null;
  for (const file of PYTHON_ENTRYPOINTS) {
    if (await exists(dir, file)) {
      startCommand = ['python', file];
      facts.startCommand = rule(`python ${file}`, `${file} in the repo root`);
      break;
    }
  }
  if (!startCommand && needStart) {
    throw new AppError(`Python project needs one of ${PYTHON_ENTRYPOINTS.join(', ')} in the repo root`);
  }
  facts.port = byDefault(PYTHON_PORT, 'injected as $PORT (FR-16)');
  assumptions.push(`The app listens on $PORT (${PYTHON_PORT}) on 0.0.0.0.`);
  return { startCommand, python: { version: PYTHON_VERSION } };
}

async function exists(dir, file) {
  try {
    await access(path.join(dir, file));
    return true;
  } catch {
    return false;
  }
}
