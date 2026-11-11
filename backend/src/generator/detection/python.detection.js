import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../utils/AppError.js';

// Python facts (FR-14, M7): where the dependencies are, the Python version,
// the framework, the entry module and app variable, and the server command.
//
//   dependencies  requirements.txt, else pyproject.toml: `pip install .` when
//                 it has a [build-system], else its [project] dependencies
//   version       .python-version, runtime.txt, requires-python; default 3.12
//   framework     Django, FastAPI or Flask, from the dependency names
//   entry         Flask/FastAPI: a top-level `app = Flask(...)` line (or
//                 Flask's `def create_app(`); Django: the wsgi.py that calls
//                 get_wsgi_application()
//   server        gunicorn for Flask and Django, uvicorn for FastAPI, always
//                 bound to 0.0.0.0:$PORT on the command line, so a repo's own
//                 gunicorn config can't move the port (FR-16). Installed into
//                 the image when the repo doesn't list it
//   no framework  `python main.py` / app.py / server.py, as before P4
//
// Only *.py files and the manifests are read; never .env files or anything
// else. Facts Kairo can't find are left out for Gemini to fill (FR-17, P4c).

export const PYTHON_PORT = 8000;
export const DEFAULT_PYTHON_VERSION = '3.12';
// minors with an official python:<v>-slim image (checked 11 Nov 2026)
export const PYTHON_VERSIONS = ['3.9', '3.10', '3.11', '3.12', '3.13', '3.14', '3.15'];
const SCRIPT_ENTRYPOINTS = ['main.py', 'app.py', 'server.py'];

// files checked first when looking for the app, root before subfolders
const PREFERRED_FILES = ['app.py', 'main.py', 'wsgi.py', 'asgi.py', 'server.py', 'application.py', 'run.py', 'api.py'];
const SKIP_DIRS = new Set([
  '.git', '.github', 'venv', '.venv', 'env', '.env', 'node_modules', '__pycache__', 'site-packages',
  'tests', 'test', 'migrations', 'docs', 'build', 'dist', '.tox',
]);
const MAX_FILES = 300;
const MAX_BYTES = 64 * 1024;

const FRAMEWORKS = {
  DJANGO: { label: 'Django', server: 'gunicorn' },
  FASTAPI: { label: 'FastAPI', server: 'uvicorn', pattern: /^([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*(?:fastapi\.)?FastAPI\(/gm },
  FLASK: { label: 'Flask', server: 'gunicorn', pattern: /^([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*(?:flask\.)?Flask\(/gm },
};

const rule = (value, from) => ({ value, source: 'rule', from });
const byDefault = (value, from) => ({ value, source: 'default', from });

/**
 * @param {string} dir the clone
 * @returns {Promise<{ startCommand: string[]|null, python: object }>}
 *   python: { version, framework, install, packages, serverPackage, collectstatic }
 */
export async function detectPython(dir, facts, assumptions, { needStart }) {
  const read = (f) => readFile(path.join(dir, f), 'utf8').catch(() => null);
  const requirements = await read('requirements.txt');
  const pyproject = requirements === null ? await read('pyproject.toml') : null;
  facts.stack = rule('Python', requirements !== null ? 'requirements.txt' : 'pyproject.toml');

  // dependencies
  let deps;
  let install;
  let packages = [];
  if (requirements !== null) {
    deps = requirementNames(requirements);
    // -r other.txt, -e . or a local path need the whole repo in the image first
    install = /^\s*(-[rce]\b|--requirement|--editable|\.)/m.test(requirements) ? 'requirements-after-copy' : 'requirements';
    facts.dependencies = rule('pip install -r requirements.txt', 'requirements.txt');
  } else {
    const project = parsePyproject(pyproject ?? '');
    deps = project.dependencies.map(requirementName).filter(Boolean);
    if (project.buildSystem) {
      install = 'project';
      facts.dependencies = rule('pip install .', 'pyproject.toml [build-system]');
    } else {
      install = 'packages';
      packages = project.dependencies;
      facts.dependencies = rule(
        packages.length ? `pip install ${packages.length} package(s)` : 'none',
        'pyproject.toml [project] dependencies',
      );
    }
  }

  // Python version
  const version = await pythonVersion(dir, read, pyproject ?? (await read('pyproject.toml')));
  facts.pythonVersion = version.source === 'rule' ? rule(version.value, version.from) : byDefault(version.value, version.from);
  if (version.note) assumptions.push(version.note);

  // framework, entry and server
  const frameworkKey = deps.includes('django') ? 'DJANGO' : deps.includes('fastapi') ? 'FASTAPI' : deps.includes('flask') ? 'FLASK' : null;
  const from = requirements !== null ? 'requirements.txt' : 'pyproject.toml';
  let startCommand = null;
  let serverPackage = null;
  let collectstatic = false;

  if (frameworkKey) {
    const fw = FRAMEWORKS[frameworkKey];
    facts.framework = rule(fw.label, `${fw.label.toLowerCase()} in ${from}`);
    const entry = frameworkKey === 'DJANGO' ? await findDjango(dir) : await findApp(dir, fw);
    if (entry) {
      facts.appEntry = rule(entry.target, entry.from);
      if (entry.note) assumptions.push(entry.note);
      startCommand = serverCommand(fw.server, entry);
      facts.startCommand = rule(startCommand.join(' '), `${fw.label} app ${entry.target}`);
      if (!deps.includes(fw.server)) {
        serverPackage = fw.server;
        assumptions.push(`${fw.server} isn't in ${from}; Kairo installs it in the image to serve the app.`);
      }
      if (entry.staticRoot) {
        collectstatic = true;
        facts.staticFiles = rule('python manage.py collectstatic', `STATIC_ROOT in ${entry.settingsFile}`);
      }
    } else {
      assumptions.push(
        frameworkKey === 'DJANGO'
          ? 'Django is a dependency, but Kairo found no wsgi.py calling get_wsgi_application().'
          : `${fw.label} is a dependency, but Kairo found no top-level \`app = ${fw.label}(...)\` line.`,
      );
    }
  } else {
    facts.framework = rule('none', `no Django, FastAPI or Flask in ${from}`);
  }

  // a plain script, or the fallback when the framework's app wasn't found
  if (!startCommand) {
    for (const file of SCRIPT_ENTRYPOINTS) {
      if (await read(file) !== null) {
        startCommand = ['python', file];
        facts.startCommand = rule(`python ${file}`, `${file} in the repo root`);
        break;
      }
    }
  }
  if (!startCommand && needStart) {
    const what = frameworkKey
      ? `a ${FRAMEWORKS[frameworkKey].label} app Kairo could find`
      : `a Django, FastAPI or Flask dependency, or one of ${SCRIPT_ENTRYPOINTS.join(', ')} in the repo root`;
    throw new AppError(`Python project has no start command: it needs ${what}`);
  }

  facts.port = byDefault(PYTHON_PORT, 'injected as $PORT (FR-16)');
  assumptions.push(`The app listens on $PORT (${PYTHON_PORT}) on 0.0.0.0.`);

  return {
    startCommand,
    python: {
      version: version.value,
      framework: frameworkKey,
      frameworkLabel: frameworkKey ? FRAMEWORKS[frameworkKey].label : null,
      install,
      packages,
      serverPackage,
      collectstatic,
    },
  };
}

// the server command, exec form. A module in a folder without __init__.py is
// a script folder: the server runs from inside it so its imports still work
export function serverCommand(server, entry) {
  const where = entry.chdir ? (server === 'uvicorn' ? ['--app-dir', entry.chdir] : ['--chdir', entry.chdir]) : [];
  if (server === 'uvicorn') return ['uvicorn', entry.target, '--host', '0.0.0.0', '--port', String(PYTHON_PORT), ...where];
  return ['gunicorn', '--bind', `0.0.0.0:${PYTHON_PORT}`, '--access-logfile', '-', ...where, entry.target];
}

// ---------- dependencies ----------

/** `Flask==3.0.3`, `uvicorn[standard]>=0.25 ; python_version>"3.8"` -> normalized names */
export function requirementNames(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '').trim())
    .filter((l) => l && !l.startsWith('-'))
    .map(requirementName)
    .filter(Boolean);
}

export function requirementName(spec) {
  const name = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1];
  return name ? name.toLowerCase().replace(/[-_.]+/g, '-') : null;
}

/**
 * Just enough TOML for pyproject.toml: [build-system], and [project]'s
 * dependencies and requires-python. No new dependency for a TOML parser.
 */
export function parsePyproject(text) {
  const tables = {};
  let current = null;
  for (const line of text.split('\n')) {
    const header = /^\s*\[([^\][]+)\]\s*(#.*)?$/.exec(line);
    if (header) {
      current = header[1].trim();
      tables[current] ??= '';
    } else if (current) tables[current] += `${line}\n`;
  }
  const project = tables.project ?? '';
  const start = /^\s*dependencies\s*=\s*\[/m.exec(project);
  const dependencies = start ? stringArray(project.slice(start.index + start[0].length)) : [];
  const requiresPython = /^\s*requires-python\s*=\s*["']([^"']+)["']/m.exec(project)?.[1] ?? null;
  return { buildSystem: 'build-system' in tables, dependencies, requiresPython };
}

// the quoted strings of a TOML array, up to its closing ] outside quotes
// ("uvicorn[standard]" has brackets of its own); comments skipped
function stringArray(text) {
  const out = [];
  let i = 0;
  while (i < text.length && text[i] !== ']') {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      if (end === -1) break;
      out.push(text.slice(i + 1, end).trim());
      i = end + 1;
    } else if (c === '#') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
    } else i++;
  }
  return out.filter(Boolean);
}

// ---------- Python version ----------

async function pythonVersion(dir, read, pyproject) {
  const file = await read('.python-version');
  if (file !== null) {
    const line = file.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    const v = /(\d+)\.(\d+)/.exec(line ?? '');
    if (v) return pick(`${v[1]}.${v[2]}`, `.python-version "${line}"`);
  }
  const runtime = await read('runtime.txt');
  const r = /python-(\d+)\.(\d+)/.exec(runtime ?? '');
  if (r) return pick(`${r[1]}.${r[2]}`, `runtime.txt "${runtime.trim()}"`);
  const spec = pyproject ? parsePyproject(pyproject).requiresPython : null;
  if (spec) {
    const fits = PYTHON_VERSIONS.filter((v) => satisfies(v, spec));
    const value = fits.includes(DEFAULT_PYTHON_VERSION) ? DEFAULT_PYTHON_VERSION : fits.at(-1);
    if (value) return { value, source: 'rule', from: `requires-python "${spec}"` };
    return {
      value: DEFAULT_PYTHON_VERSION,
      source: 'default',
      from: `requires-python "${spec}" has no version Kairo builds with`,
      note: `requires-python is "${spec}"; Kairo used Python ${DEFAULT_PYTHON_VERSION}.`,
    };
  }
  return { value: DEFAULT_PYTHON_VERSION, source: 'default', from: 'no .python-version, runtime.txt or requires-python' };
}

// a version the repo names, moved to the nearest one with an image
function pick(wanted, from) {
  if (PYTHON_VERSIONS.includes(wanted)) return { value: wanted, source: 'rule', from };
  const minor = (v) => Number(v.split('.')[1]);
  const value = minor(wanted) > minor(PYTHON_VERSIONS.at(-1)) ? PYTHON_VERSIONS.at(-1) : PYTHON_VERSIONS[0];
  return { value, source: 'rule', from, note: `${from} asks for Python ${wanted}, which has no image Kairo uses; it built with ${value}.` };
}

/** Does Python 3.<minor> satisfy a PEP 440 spec like ">=3.10,<3.13"? Minor-level only. Exported for the tests. */
export function satisfies(version, spec) {
  const minor = Number(version.split('.')[1]);
  return spec.split(',').every((clause) => {
    const m = /^\s*(~=|==|!=|<=|>=|<|>)\s*3\.(\d+|\*)/.exec(clause);
    if (!m) return true;
    const [, op, raw] = m;
    if (raw === '*') return op !== '!=';
    const n = Number(raw);
    switch (op) {
      case '>=':
      case '~=':
      case '>':
        return minor >= n;
      case '<':
        return minor < n;
      case '<=':
        return minor <= n;
      case '==':
        return minor === n;
      default:
        return true; // != 3.x.y excludes one patch, not the minor
    }
  });
}

// ---------- finding the app ----------

// *.py files in the root and one folder down, the preferred names first
async function pythonFiles(dir) {
  const found = [];
  const walk = async (rel, depth) => {
    let entries;
    try {
      entries = await readdir(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= MAX_FILES) return;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && depth < 1 && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.py')) found.push(p);
    }
  };
  await walk('', 0);
  const rank = (p) => {
    const name = path.basename(p);
    const i = PREFERRED_FILES.indexOf(name);
    return (p.includes('/') ? 100 : 0) + (i === -1 ? PREFERRED_FILES.length : i);
  };
  return found.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

async function readHead(dir, rel) {
  const text = await readFile(path.join(dir, rel), 'utf8').catch(() => '');
  return text.slice(0, MAX_BYTES);
}

// "pkg/main.py" -> where to run from and the module name
async function moduleOf(dir, rel) {
  const parts = rel.replace(/\.py$/, '').split('/');
  if (parts.length === 1) return { module: parts[0], chdir: null };
  const pkg = parts[0];
  const isPackage = await readFile(path.join(dir, pkg, '__init__.py')).then(() => true, () => false);
  return isPackage ? { module: parts.join('.'), chdir: null } : { module: parts.at(-1), chdir: pkg };
}

async function findApp(dir, fw) {
  const candidates = [];
  for (const rel of await pythonFiles(dir)) {
    const text = await readHead(dir, rel);
    const vars = [...text.matchAll(fw.pattern)].map((m) => m[1]);
    // Flask's application factory; gunicorn calls it
    const factory = fw.label === 'Flask' && /^def create_app\(\s*\)/m.test(text);
    if (vars.length || factory) {
      const variable = vars.includes('app') ? 'app' : (vars[0] ?? null);
      candidates.push({ rel, call: variable ?? 'create_app()' });
    }
  }
  if (!candidates.length) return null;
  const [first, ...others] = candidates;
  const { module, chdir } = await moduleOf(dir, first.rel);
  const shown = `${first.call.endsWith('()') ? 'def create_app()' : `${first.call} = ${fw.label}(...)`} in ${first.rel}`;
  return {
    target: `${module}:${first.call}`,
    chdir,
    from: shown,
    note: others.length
      ? `${fw.label} apps are defined in ${[first, ...others].map((c) => c.rel).join(', ')}; Kairo serves the one in ${first.rel}.`
      : null,
  };
}

async function findDjango(dir) {
  for (const rel of await pythonFiles(dir)) {
    if (path.basename(rel) !== 'wsgi.py') continue;
    const text = await readHead(dir, rel);
    if (!/get_wsgi_application\(/.test(text)) continue;
    const { module, chdir } = await moduleOf(dir, rel);
    // collectstatic when the settings name a STATIC_ROOT and manage.py exists
    const settings = /DJANGO_SETTINGS_MODULE["']\s*,\s*["']([\w.]+)["']/.exec(text)?.[1];
    const settingsFile = settings ? `${settings.replaceAll('.', '/')}.py` : null;
    const settingsText = settingsFile ? await readHead(dir, chdir ? `${chdir}/${settingsFile}` : settingsFile) : '';
    const manage = await readFile(path.join(dir, chdir ?? '', 'manage.py')).then(() => true, () => false);
    return {
      target: module,
      chdir,
      from: `get_wsgi_application() in ${rel}`,
      staticRoot: manage && /^STATIC_ROOT\s*=/m.test(settingsText) && !chdir,
      settingsFile,
    };
  }
  return null;
}
