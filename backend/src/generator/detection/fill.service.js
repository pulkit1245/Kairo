import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { askGemini, geminiEnabled } from '../../gemini/gemini.client.js';
import { isSecretFile, redact } from '../../gemini/redact.service.js';
import { createLogger } from '../../utils/logger.js';
import { applyGeminiFact } from './detection.service.js';

// Gemini fact-filling (FR-17 to FR-20). Only for facts the rules left unknown,
// in one call per pipeline, cached per commit sha. Gemini sees:
//   - the file tree: paths only, up to 300 (FR-18)
//   - the manifest files
//   - the first 60 lines of up to 3 candidate files
// never a .env* file, a key file, or anything that looks like a secret (redacted
// by pattern first). Its answer is JSON against FACT_SCHEMA, checked against the
// repo (applyGeminiFact); a value that fails is dropped and the rule's reason
// stands, so the run fails at DETECTING as it would without Gemini.

const log = createLogger('facts');

export const MAX_PATHS = 300;
export const HEAD_LINES = 60;
export const MAX_CANDIDATES = 3;
const MANIFESTS = ['package.json', 'requirements.txt', 'pyproject.toml', 'Procfile'];
const MAX_MANIFEST_CHARS = 8000;
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'venv', '.venv', 'env', '__pycache__', 'site-packages', '.tox', '.next',
  '.cache', 'coverage', 'vendor', 'bower_components',
]);

// FR-19: the fixed answer schema. Empty strings mean "don't know"
export const FACT_SCHEMA = {
  type: 'object',
  properties: {
    startFile: {
      type: 'string',
      description: 'Path, relative to the repo root, of the file that starts the app. "" if unsure.',
    },
    appVariable: {
      type: 'string',
      description: 'Flask or FastAPI only: the name of the app object defined at the top level of startFile, or the factory as "create_app()". Otherwise "".',
    },
    reason: { type: 'string', description: 'One short sentence: why this file.' },
  },
  required: ['startFile', 'appVariable', 'reason'],
};

const QUESTIONS = {
  NODE_START_FILE: 'Which JavaScript file starts this Node.js web server? Kairo will run it with `node <startFile>`.',
  PYTHON_APP: (fw) => `Which Python file defines the ${fw} app object at the top level, and what is the variable called? Kairo will serve it with ${fw === 'FastAPI' ? 'uvicorn' : 'gunicorn'} as module:variable.`,
  DJANGO_WSGI: 'Which wsgi.py file calls get_wsgi_application()? Kairo will serve it with gunicorn.',
  PYTHON_START_FILE: 'Which Python file starts this web server? Kairo will run it with `python <startFile>`.',
};

const INSTRUCTIONS = `You help Kairo, a tool that deploys GitHub repos to Kubernetes, find facts its rules could not read from a repo.
Answer only from the files shown. Give paths exactly as they appear in the file tree.
If the answer isn't clear from what you are shown, return empty strings rather than guessing.
Keep reason to one short sentence a student would understand.`;

/**
 * Fills detected.unknown in place, where Gemini can. Never throws.
 * @param {string} dir the clone
 * @param {object} detected what detectFacts() returned
 * @param {{ commitSha: string }} ctx
 * @returns {Promise<{ asked: boolean, filled: string[], dropped: string|null }>}
 */
export async function fillUnknownFacts(dir, detected, { commitSha }, ask = askGemini) {
  const item = detected.unknown[0];
  if (!item) return { asked: false, filled: [], dropped: null };
  if (!geminiEnabled()) {
    log.info(`${item.fact} unknown; Gemini is off, so the rules' reason stands`);
    return { asked: false, filled: [], dropped: null };
  }

  let input;
  try {
    input = await buildInput(dir, detected, item);
  } catch (err) {
    log.warn(`could not read the repo for Gemini: ${err.message}`);
    return { asked: false, filled: [], dropped: null };
  }
  const answer = await ask({
    purpose: `${item.fact} for ${commitSha.slice(0, 7)}`,
    instructions: INSTRUCTIONS,
    input,
    schema: FACT_SCHEMA,
    // v1: bump when the question or schema changes, so old answers aren't reused
    cache: { commitSha, question: `facts:v1:${item.ask}` },
  });
  if (!answer) return { asked: true, filled: [], dropped: null };

  const { startFile = '', appVariable = '', reason = '' } = answer.data;
  if (!String(startFile).trim()) {
    detected.assumptions.push(`Gemini was asked for the start file and wasn't sure.`);
    return { asked: true, filled: [], dropped: 'Gemini was not sure' };
  }
  // one line, short: it shows as where the fact came from
  const why = String(reason).replace(/\s+/g, ' ').trim().slice(0, 160) || 'no reason given';
  const dropped = await applyGeminiFact(dir, detected, item, { startFile: String(startFile), appVariable: String(appVariable) }, why);
  if (dropped) {
    log.warn(`dropped Gemini's ${item.fact}: ${dropped}`);
    detected.assumptions.push(`Gemini suggested ${startFile}, but ${dropped}, so Kairo didn't use it.`);
    return { asked: true, filled: [], dropped };
  }
  log.info(`${item.fact} filled by Gemini: ${detected.facts[item.fact].value}`);
  return { asked: true, filled: [item.fact], dropped: null };
}

// FR-18: exactly what Gemini is sent, as one text. Exported for the tests
export async function buildInput(dir, detected, item) {
  const tree = await fileTree(dir);
  const fw = detected.python?.frameworkLabel;
  const question = typeof QUESTIONS[item.ask] === 'function' ? QUESTIONS[item.ask](fw) : QUESTIONS[item.ask];
  const parts = [
    `Question: ${question}`,
    `What Kairo's rules found: ${item.hint}`,
    `File tree (${tree.length}${tree.truncated ? `, first ${MAX_PATHS}` : ''} paths):\n${tree.join('\n')}`,
  ];
  for (const name of MANIFESTS) {
    const text = await readFile(path.join(dir, name), 'utf8').catch(() => null);
    if (text !== null) parts.push(`--- ${name} ---\n${redact(text.slice(0, MAX_MANIFEST_CHARS))}`);
  }
  for (const rel of candidates(tree, detected.stack)) {
    const text = await readFile(path.join(dir, rel), 'utf8').catch(() => null);
    if (text === null) continue;
    const head = text.split('\n').slice(0, HEAD_LINES).join('\n');
    parts.push(`--- ${rel} (first ${HEAD_LINES} lines) ---\n${redact(head)}`);
  }
  return parts.join('\n\n');
}

// repo paths, breadth first (shallow files first), skipping dependency folders
// and secret files, at most MAX_PATHS
export async function fileTree(dir) {
  const out = [];
  let truncated = false;
  let level = [''];
  while (level.length && !truncated) {
    const next = [];
    for (const rel of level) {
      let entries;
      try {
        entries = await readdir(path.join(dir, rel), { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) next.push(p);
        } else if (e.isFile() && !isSecretFile(p)) {
          if (out.length >= MAX_PATHS) {
            truncated = true;
            break;
          }
          out.push(p);
        }
      }
      if (truncated) break;
    }
    level = next;
  }
  out.truncated = truncated;
  return out;
}

// up to 3 files most likely to start the app: entry-like names first, then
// the shallowest
const ENTRY_NAMES = ['index', 'server', 'app', 'main', 'wsgi', 'asgi', 'run', 'start', 'api'];
export function candidates(tree, stack) {
  const ext = stack === 'PYTHON' ? /\.py$/ : /\.(c|m)?js$/;
  const skip = /(^|\/)(tests?|__tests__|spec|docs?|examples?|scripts|migrations|dist|build|public|static)\//;
  const rank = (p) => {
    const base = path.posix.basename(p).replace(/\.\w+$/, '');
    const i = ENTRY_NAMES.indexOf(base);
    return (i === -1 ? 100 : i * 10) + p.split('/').length - (p.startsWith('src/') ? 1 : 0);
  };
  return tree
    .filter((p) => ext.test(p) && !skip.test(p) && !/\.(test|spec|config)\.\w+$/.test(p))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .slice(0, MAX_CANDIDATES);
}
