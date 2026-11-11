import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { detectStack } from '../../src/generator/detection/detection.service.js';
import { parsePyproject, requirementNames, satisfies } from '../../src/generator/detection/python.detection.js';
import { generateConfigs } from '../../src/generator/template/config.service.js';

// One case per repo shape in the reference set (FR-14), plus pyproject.toml
// and the fallbacks.

let dir;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'kairo-py-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const put = async (file, content = '') => {
  await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
  await writeFile(path.join(dir, file), content);
};

const dockerfile = (detected) =>
  generateConfigs({
    pipelineRunId: 'r1',
    appName: 'demo',
    commitSha: 'a'.repeat(40),
    namespace: 'kairo-demo',
    repoFullName: 'me/demo',
    defaultBranch: 'main',
    detected,
  }).find((f) => f.kind === 'DOCKERFILE').content;

const cmd = (d) => JSON.parse(/^CMD (.*)$/m.exec(d)[1]);

describe('Python frameworks (FR-14)', () => {
  it('Flask with gunicorn listed (render-examples/flask-hello-world)', async () => {
    await put('requirements.txt', 'Flask\nGunicorn\n');
    await put('app.py', 'from flask import Flask\napp = Flask(__name__)\n\n@app.route("/")\ndef hi():\n    return "hi"\n');
    const r = await detectStack(dir);
    assert.equal(r.facts.framework.value, 'Flask');
    assert.equal(r.facts.appEntry.value, 'app:app');
    assert.deepEqual(r.startCommand, ['gunicorn', '--bind', '0.0.0.0:8000', '--access-logfile', '-', 'app:app']);
    assert.equal(r.python.serverPackage, null, 'gunicorn is already a dependency');
    const d = dockerfile(r);
    assert.match(d, /^RUN pip install --no-cache-dir -r requirements.txt$/m);
    assert.doesNotMatch(d, /pip install --no-cache-dir gunicorn/);
  });

  it("binds the port on the command line, whatever the repo's gunicorn config says (digitalocean/sample-flask)", async () => {
    await put('requirements.txt', 'Flask==3.0.3\ngunicorn==23.0.0\n');
    await put('gunicorn_config.py', 'bind = "0.0.0.0:8080"\n');
    await put('app.py', 'from flask import Flask, render_template\n\napp = Flask(__name__)\n');
    const r = await detectStack(dir);
    assert.ok(r.startCommand.includes('0.0.0.0:8000'));
  });

  it('FastAPI under uvicorn, version from .python-version (koyeb/example-fastapi)', async () => {
    await put('requirements.txt', 'fastapi==0.109.0\nuvicorn==0.25.0\n');
    await put('.python-version', '3.11');
    await put('main.py', 'from fastapi import FastAPI\n\napp = FastAPI()\n');
    const r = await detectStack(dir);
    assert.equal(r.facts.framework.value, 'FastAPI');
    assert.deepEqual(r.startCommand, ['uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8000']);
    assert.deepEqual(r.facts.pythonVersion, { value: '3.11', source: 'rule', from: '.python-version "3.11"' });
    assert.match(dockerfile(r), /^FROM python:3\.11-slim$/m);
  });

  it('Django: the wsgi module, collectstatic when STATIC_ROOT is set (heroku/python-getting-started)', async () => {
    await put('requirements.txt', 'django>=6.1,<6.2\ngunicorn>=26,<27\n');
    await put('.python-version', '# The Python version to use\n3.15\n');
    await put('manage.py', '');
    await put('mysite/__init__.py', '');
    await put(
      'mysite/wsgi.py',
      'import os\nfrom django.core.wsgi import get_wsgi_application\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")\napplication = get_wsgi_application()\n',
    );
    await put('mysite/settings.py', 'STATIC_ROOT = BASE_DIR / "staticfiles"\n');
    const r = await detectStack(dir);
    assert.equal(r.facts.framework.value, 'Django');
    assert.equal(r.facts.appEntry.value, 'mysite.wsgi');
    assert.equal(r.startCommand.at(-1), 'mysite.wsgi');
    assert.equal(r.python.version, '3.15');
    const d = dockerfile(r);
    // collected after the code is in the image
    assert.ok(d.indexOf('COPY . .') < d.indexOf('RUN python manage.py collectstatic --noinput'));
  });

  it('installs the server when the repo does not list it, and says so', async () => {
    await put('requirements.txt', 'fastapi\n');
    await put('main.py', 'import fastapi\napi = fastapi.FastAPI(title="x")\n');
    const r = await detectStack(dir);
    assert.equal(r.facts.appEntry.value, 'main:api');
    assert.equal(r.python.serverPackage, 'uvicorn');
    assert.ok(r.assumptions.some((a) => a.includes("uvicorn isn't in requirements.txt")));
    assert.match(dockerfile(r), /^RUN pip install --no-cache-dir uvicorn$/m);
  });

  it('finds the app one folder down: package or script folder', async () => {
    await put('requirements.txt', 'flask\n');
    await put('web/__init__.py', '');
    await put('web/app.py', 'from flask import Flask\napp = Flask(__name__)\n');
    assert.equal((await detectStack(dir)).facts.appEntry.value, 'web.app:app');

    await rm(path.join(dir, 'web/__init__.py'));
    const r = await detectStack(dir);
    assert.equal(r.facts.appEntry.value, 'app:app');
    assert.deepEqual(r.startCommand.slice(5), ['--chdir', 'web', 'app:app']);
  });

  it("uses Flask's application factory", async () => {
    await put('requirements.txt', 'flask\n');
    await put('wsgi.py', 'from flask import Flask\n\ndef create_app():\n    return Flask(__name__)\n');
    assert.equal((await detectStack(dir)).facts.appEntry.value, 'wsgi:create_app()');
  });

  it('several apps: the preferred file wins and the PR says so', async () => {
    await put('requirements.txt', 'flask\n');
    await put('admin.py', 'from flask import Flask\napp = Flask("admin")\n');
    await put('app.py', 'from flask import Flask\napp = Flask(__name__)\n');
    const r = await detectStack(dir);
    assert.equal(r.facts.appEntry.value, 'app:app');
    assert.ok(r.assumptions.some((a) => a.includes('admin.py')));
  });

  it("an indented or commented line isn't the app", async () => {
    await put('requirements.txt', 'flask\n');
    await put('app.py', 'def make():\n    app = Flask(__name__)\n# app = Flask(x)\n');
    const r = await detectStack(dir);
    // falls back to running the file, and says why
    assert.deepEqual(r.startCommand, ['python', 'app.py']);
    assert.ok(r.assumptions.some((a) => a.includes('no top-level')));
  });

  it('a plain script still runs with python (digitalocean/sample-python)', async () => {
    await put('requirements.txt', '');
    await put('server.py', 'import http.server\n');
    const r = await detectStack(dir);
    assert.equal(r.facts.framework.value, 'none');
    assert.deepEqual(r.startCommand, ['python', 'server.py']);
  });

  it('fails at detection when there is nothing to run', async () => {
    await put('requirements.txt', 'flask\n');
    await put('helpers.py', 'x = 1\n');
    await assert.rejects(detectStack(dir), /no start command: it needs a Flask app/);
  });
});

describe('pyproject.toml (FR-11)', () => {
  it('marks Python, and installs a package project with pip install .', async () => {
    await put(
      'pyproject.toml',
      '[build-system]\nrequires = ["hatchling"]\n\n[project]\nname = "demo"\nrequires-python = ">=3.10"\ndependencies = [\n  "fastapi>=0.110",\n  "uvicorn[standard]",\n]\n',
    );
    await put('main.py', 'from fastapi import FastAPI\napp = FastAPI()\n');
    const r = await detectStack(dir);
    assert.equal(r.stack, 'PYTHON');
    assert.equal(r.python.install, 'project');
    assert.equal(r.python.version, '3.12', 'the default satisfies >=3.10');
    assert.equal(r.python.serverPackage, null, 'uvicorn[standard] counts');
    const d = dockerfile(r);
    assert.ok(d.indexOf('COPY . .') < d.indexOf('RUN pip install --no-cache-dir .'));
  });

  it('without a build-system: installs the listed dependencies (exec form, no shell)', async () => {
    await put('pyproject.toml', '[project]\nname = "demo"\nrequires-python = "<3.12"\ndependencies = ["flask>=3", \'gunicorn\']\n');
    await put('app.py', 'from flask import Flask\napp = Flask(__name__)\n');
    const r = await detectStack(dir);
    assert.equal(r.python.install, 'packages');
    assert.equal(r.python.version, '3.11');
    assert.match(dockerfile(r), /^RUN \["pip","install","--no-cache-dir","flask>=3","gunicorn"\]$/m);
  });

  it('requirements.txt wins over pyproject.toml for the dependencies', async () => {
    await put('requirements.txt', 'flask\n');
    await put('pyproject.toml', '[project]\ndependencies = ["fastapi"]\n');
    await put('app.py', 'from flask import Flask\napp = Flask(__name__)\n');
    assert.equal((await detectStack(dir)).facts.framework.value, 'Flask');
  });
});

describe('Python helpers', () => {
  it('reads requirement names', () => {
    assert.deepEqual(
      requirementNames('# web\nFlask==3.0\n-r base.txt\nuvicorn[standard]>=0.2 ; python_version>"3.8"\nDjango_Rest.Framework\n\n'),
      ['flask', 'uvicorn', 'django-rest-framework'],
    );
  });

  it('reads just enough of pyproject.toml', () => {
    const p = parsePyproject('[tool.x]\ndependencies = ["nope"]\n[project]\nrequires-python = ">=3.11"\ndependencies = []\n');
    assert.deepEqual(p, { buildSystem: false, dependencies: [], requiresPython: '>=3.11' });
  });

  it('matches requires-python at the minor level', () => {
    assert.equal(satisfies('3.12', '>=3.10,<3.13'), true);
    assert.equal(satisfies('3.13', '>=3.10,<3.13'), false);
    assert.equal(satisfies('3.11', '==3.11.*'), true);
    assert.equal(satisfies('3.11', '~=3.11'), true);
    assert.equal(satisfies('3.10', '~=3.11'), false);
  });

  it('moves a version without an image to the nearest one', async () => {
    await put('requirements.txt', '');
    await put('main.py', '');
    await put('runtime.txt', 'python-3.7.9\n');
    const r = await detectStack(dir);
    assert.equal(r.python.version, '3.9');
    assert.ok(r.assumptions.some((a) => a.includes('Python 3.7')));
  });
});
