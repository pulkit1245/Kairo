import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../utils/AppError.js';
import { applyPythonStart, detectPython, PYTHON_PORT } from './python.detection.js';

// Stack detection (FR-11 to FR-16). Rules first; a fact they can't find (the
// start file, so far) is listed in `unknown` for Gemini to fill (FR-17,
// fill.service.js). Python's rules are in python.detection.js.
//
// Rule order (FR-11): an existing Dockerfile is kept, then package.json means
// Node, then requirements.txt or pyproject.toml means Python. A kept Dockerfile still reads the
// manifests, because the workflow's test step needs the Node facts.
//
// Every fact records where it came from (FR-15), shown in the onboarding view
// and the PR:
//   { value, source: 'rule' | 'default' | 'gemini', from: 'package-lock.json' }

export const NODE_PORT = 3000;
export { PYTHON_PORT };
export const DEFAULT_NODE_VERSION = 22;
// majors with an official node:<n>-slim image Kairo will use
export const NODE_VERSIONS = [18, 20, 22, 24];
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
 *   python: null | { version: string, framework: 'DJANGO'|'FASTAPI'|'FLASK'|null,
 *                    install: 'requirements'|'requirements-after-copy'|'project'|'packages',
 *                    packages: string[], serverPackage: string|null, collectstatic: boolean },
 *   facts: Record<string, { value: any, source: 'rule'|'default'|'gemini', from: string }>,
 *   assumptions: string[],
 *   unknown: Array<{ fact: string, ask: string, reason: string, hint: string }>,
 * }>}
 *   unknown: facts the rules couldn't find, for Gemini (FR-17). reason is the
 *   failure if nobody fills them
 */
export async function detectFacts(dir) {
  const has = (f) => exists(dir, f);
  const facts = {};
  const assumptions = [];
  const unknown = [];

  let existingDockerfile = null;
  if (await has('Dockerfile')) {
    existingDockerfile = await readFile(path.join(dir, 'Dockerfile'), 'utf8');
    facts.dockerfile = rule('kept as it is', 'Dockerfile in the repo root');
  }

  const hasNode = await has('package.json');
  const hasPython = (await has('requirements.txt')) || (await has('pyproject.toml'));

  if (hasNode) {
    if (hasPython) {
      // PRD section 8: pick Node, record the guess, flag it in the PR
      const manifest = (await has('requirements.txt')) ? 'requirements.txt' : 'pyproject.toml';
      assumptions.push(`The repo has both package.json and ${manifest}; Kairo treated it as a Node.js app.`);
    }
    const node = await detectNode(dir, facts, assumptions, unknown, { needStart: !existingDockerfile });
    return result('NODE', NODE_PORT, node.startCommand, { existingDockerfile, node: node.node, facts, assumptions, unknown });
  }

  if (hasPython) {
    const py = await detectPython(dir, facts, assumptions, unknown, { needStart: !existingDockerfile });
    return result('PYTHON', PYTHON_PORT, py.startCommand, { existingDockerfile, python: py.python, facts, assumptions, unknown });
  }

  if (existingDockerfile) {
    facts.stack = byDefault('unknown', 'no package.json, requirements.txt or pyproject.toml');
    facts.port = byDefault(NODE_PORT, 'injected as $PORT (FR-16)');
    assumptions.push(`The Dockerfile's app listens on $PORT (${NODE_PORT}) on 0.0.0.0; Kairo injects PORT and can't read it from the Dockerfile.`);
    return result(null, NODE_PORT, null, { existingDockerfile, facts, assumptions, unknown });
  }

  throw new AppError(
    'Unsupported stack: expected a Dockerfile, package.json (Node), or requirements.txt or pyproject.toml (Python) in the repo root',
  );
}

function result(stack, port, startCommand, rest) {
  return { stack, port, startCommand, existingDockerfile: null, node: null, python: null, unknown: [], ...rest };
}

// Rules only: fails on any fact left unknown. The pipeline calls detectFacts,
// lets Gemini fill what it can, then assertKnown
export async function detectStack(dir) {
  return assertKnown(await detectFacts(dir));
}

// the first fact still unknown fails detection with the rule's reason
export function assertKnown(detected) {
  if (detected.unknown.length) throw new AppError(detected.unknown[0].reason);
  return detected;
}

/**
 * Gemini's answer for an unknown fact (fill.service.js), checked against the
 * repo before it is used (FR-19). On success the fact is filled with source
 * 'gemini' and taken off `unknown`.
 * @param {{ startFile?: string, appVariable?: string }} answer
 * @param {string} why Gemini's one-line reason, shown as where the fact came from
 * @returns {Promise<string|null>} null when used, else why it was dropped
 */
export async function applyGeminiFact(dir, detected, item, answer, why) {
  const file = await repoFile(dir, answer.startFile);
  if (!file.ok) return file.why;
  let dropped;
  if (item.ask === 'NODE_START_FILE') {
    if (!/\.(c|m)?js$/.test(file.rel)) return `${file.rel} isn't a .js file Node can run`;
    detected.startCommand = ['node', file.rel];
    detected.facts.startCommand = { value: `node ${file.rel}`, source: 'gemini', from: why };
    detected.assumptions.push(`Gemini picked ${file.rel} as the start file: ${why}`);
  } else {
    dropped = await applyPythonStart(dir, detected, item, file.rel, answer.appVariable, why);
    if (dropped) return dropped;
  }
  detected.unknown = detected.unknown.filter((u) => u !== item);
  return null;
}

// a path Gemini named: relative, inside the clone, an existing file
async function repoFile(dir, rel) {
  if (typeof rel !== 'string' || !rel.trim()) return { ok: false, why: 'no file given' };
  const clean = path.posix.normalize(rel.trim().replace(/^\.\//, ''));
  if (path.posix.isAbsolute(clean) || clean.startsWith('..')) return { ok: false, why: `${rel} is outside the repo` };
  const info = await stat(path.join(dir, clean)).catch(() => null);
  if (!info?.isFile()) return { ok: false, why: `${clean} isn't a file in the repo` };
  return { ok: true, rel: clean };
}

async function detectNode(dir, facts, assumptions, unknown, { needStart }) {
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
  } else if (pkg.main && (await exists(dir, pkg.main))) {
    startCommand = ['node', pkg.main];
    facts.startCommand = rule(`node ${pkg.main}`, 'main in package.json');
  } else {
    // a main that names a missing file isn't a start command: `node` would
    // exit at once and the preview would crash-loop for 3 minutes
    for (const file of NODE_ENTRYPOINTS) {
      if (await exists(dir, file)) {
        startCommand = ['node', file];
        facts.startCommand = rule(`node ${file}`, `${file} in the repo root`);
        break;
      }
    }
  }
  if (!startCommand && needStart) {
    const main = pkg.main ? `a "main" field (${pkg.main}) that isn't in the repo` : 'no "main" field';
    unknown.push({
      fact: 'startCommand',
      ask: 'NODE_START_FILE',
      reason: `Node project has no "start" script, ${main}, and no index.js or server.js`,
      hint: pkg.main
        ? `package.json has no scripts.start, and its "main" is "${pkg.main}", which isn't in the repo.`
        : 'package.json has no scripts.start and no "main", and there is no index.js or server.js in the root.',
    });
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

async function exists(dir, file) {
  try {
    await access(path.join(dir, file));
    return true;
  } catch {
    return false;
  }
}
