import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { detectStack, dockerfilePort, nodeVersion } from '../../src/generator/detection/detection.service.js';

let dir;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'kairo-detect-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const put = (file, content = '') => writeFile(path.join(dir, file), content);

describe('detectStack', () => {
  it('uses npm start when package.json has a start script', async () => {
    await put('package.json', JSON.stringify({ scripts: { start: 'node server.js' } }));
    const result = await detectStack(dir);
    assert.equal(result.stack, 'NODE');
    assert.deepEqual(result.startCommand, ['npm', 'start']);
  });

  it('falls back to the main field', async () => {
    await put('package.json', JSON.stringify({ main: 'src/app.js' }));
    await mkdir(path.join(dir, 'src'));
    await put('src/app.js');
    const result = await detectStack(dir);
    assert.deepEqual(result.startCommand, ['node', 'src/app.js']);
  });

  it('skips a main that names a missing file, then tries index.js', async () => {
    await put('package.json', JSON.stringify({ main: 'lib/missing.js' }));
    await put('index.js');
    const result = await detectStack(dir);
    assert.deepEqual(result.startCommand, ['node', 'index.js']);
    assert.equal(result.facts.startCommand.from, 'index.js in the repo root');
  });

  it('says so when main names a missing file and nothing else starts it', async () => {
    await put('package.json', JSON.stringify({ main: 'index.js' }));
    await assert.rejects(detectStack(dir), /"main" field \(index\.js\) that isn't in the repo/);
  });

  it('rejects a node project it cannot start', async () => {
    await put('package.json', '{}');
    await assert.rejects(detectStack(dir), /no "start" script/);
  });

  it('falls back to server.js after index.js (FR-12)', async () => {
    await put('package.json', '{}');
    await put('server.js');
    assert.deepEqual((await detectStack(dir)).startCommand, ['node', 'server.js']);
  });

  it('rejects broken package.json', async () => {
    await put('package.json', '{ nope');
    await assert.rejects(detectStack(dir), /not valid JSON/);
  });

  it('detects python and picks the entrypoint', async () => {
    await put('requirements.txt', 'flask\n');
    await put('app.py');
    const result = await detectStack(dir);
    assert.equal(result.stack, 'PYTHON');
    assert.deepEqual(result.startCommand, ['python', 'app.py']);
  });

  it('prefers node when both marker files exist', async () => {
    await put('package.json', JSON.stringify({ scripts: { start: 'x' } }));
    await put('requirements.txt');
    assert.equal((await detectStack(dir)).stack, 'NODE');
  });

  it('fails on anything else', async () => {
    await put('go.mod');
    await assert.rejects(detectStack(dir), /Unsupported stack/);
  });
});

describe('Node facts and their sources (FR-12, FR-13, FR-15)', () => {
  const pkg = (o) => put('package.json', JSON.stringify({ scripts: { start: 'node index.js' }, ...o }));

  it('reads the package manager from the lockfile', async () => {
    await pkg({});
    await put('pnpm-lock.yaml');
    const r = await detectStack(dir);
    assert.deepEqual(r.facts.packageManager, { value: 'pnpm', source: 'rule', from: 'pnpm-lock.yaml' });
    assert.equal(r.node.corepack, true);
    assert.equal(r.node.installCommand, 'pnpm install --frozen-lockfile --prod');
  });

  it('defaults to npm install with no lockfile, npm ci with one', async () => {
    await pkg({});
    let r = await detectStack(dir);
    assert.deepEqual(r.facts.packageManager, { value: 'npm', source: 'default', from: 'no lockfile' });
    assert.equal(r.node.installCommand, 'npm install --omit=dev');
    await put('package-lock.json', '{}');
    r = await detectStack(dir);
    assert.equal(r.node.installCommand, 'npm ci --omit=dev');
    assert.equal(r.node.ciInstallCommand, 'npm ci');
  });

  it('uses yarn 1 from the image, and corepack for yarn 2+', async () => {
    await pkg({});
    await put('yarn.lock');
    let r = await detectStack(dir);
    assert.equal(r.node.corepack, false);
    assert.equal(r.node.installCommand, 'yarn install --frozen-lockfile --production');
    await put('.yarnrc.yml');
    r = await detectStack(dir);
    assert.equal(r.node.corepack, true);
    assert.equal(r.node.installCommand, 'yarn install --immutable');
  });

  it('takes the Node version from engines.node, else 22', async () => {
    await pkg({ engines: { node: '20.x' } });
    let r = await detectStack(dir);
    assert.deepEqual(r.facts.nodeVersion, { value: 20, source: 'rule', from: 'engines.node "20.x"' });
    await pkg({});
    r = await detectStack(dir);
    assert.deepEqual(r.facts.nodeVersion, { value: 22, source: 'default', from: 'no engines.node in package.json' });
  });

  it('keeps dev dependencies for a build script, and prunes after', async () => {
    await pkg({ scripts: { start: 'node dist/index.js', build: 'tsc' } });
    await put('package-lock.json', '{}');
    const r = await detectStack(dir);
    assert.equal(r.node.installCommand, 'npm ci');
    assert.equal(r.node.buildCommand, 'npm run build');
    assert.equal(r.node.pruneCommand, 'npm prune --omit=dev');
    assert.equal(r.facts.buildScript.from, 'scripts.build in package.json');
  });

  it("ignores npm's placeholder test script", async () => {
    await pkg({ scripts: { start: 'x', test: 'echo "Error: no test specified" && exit 1' } });
    let r = await detectStack(dir);
    assert.equal(r.node.testCommand, null);
    assert.equal(r.facts.testScript.from, "scripts.test is npm's placeholder");
    await pkg({ scripts: { start: 'x', test: 'node --test' } });
    r = await detectStack(dir);
    assert.equal(r.node.testCommand, 'npm test');
  });

  it('gives every fact a source and the port as a default', async () => {
    await pkg({});
    const r = await detectStack(dir);
    for (const [name, f] of Object.entries(r.facts)) {
      assert.ok(['rule', 'default'].includes(f.source), name);
      assert.ok(f.from, name);
    }
    assert.deepEqual(r.facts.port, { value: 3000, source: 'default', from: 'injected as $PORT' });
  });

  it('flags a repo with both package.json and requirements.txt', async () => {
    await pkg({});
    await put('requirements.txt');
    const r = await detectStack(dir);
    assert.equal(r.stack, 'NODE');
    assert.match(r.assumptions.join(' '), /both package\.json and requirements\.txt/);
  });
});

describe('existing Dockerfile (FR-11, FR-25)', () => {
  it('is kept, and the manifest is still read', async () => {
    await put('Dockerfile', 'FROM node:22\n');
    await put('package.json', JSON.stringify({ scripts: { test: 'node --test' } }));
    const r = await detectStack(dir);
    assert.equal(r.existingDockerfile, 'FROM node:22\n');
    assert.equal(r.facts.dockerfile.value, 'kept as it is');
    assert.equal(r.node.testCommand, 'npm test');
  });

  it("doesn't need a start command when the Dockerfile has one", async () => {
    await put('Dockerfile', 'FROM node:22\n');
    await put('package.json', '{}');
    assert.equal((await detectStack(dir)).startCommand, null);
  });

  it('works with no manifest at all: stack unknown, PORT 3000 assumed', async () => {
    await put('Dockerfile', 'FROM busybox\n');
    const r = await detectStack(dir);
    assert.equal(r.stack, null);
    assert.equal(r.port, 3000);
    assert.match(r.assumptions[0], /no EXPOSE \(or PORT\) Kairo could read, so Kairo assumed port 3000/);
  });

  it("takes the port from the kept Dockerfile's EXPOSE (kairo-dockerfile-sample)", async () => {
    await put('Dockerfile', 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nENV PORT=8080\nEXPOSE 8080\nCMD ["node", "server.js"]\n');
    await put('package.json', JSON.stringify({ scripts: { start: 'node server.js' } }));
    const r = await detectStack(dir);
    assert.equal(r.stack, 'NODE');
    assert.equal(r.port, 8080);
    assert.deepEqual(r.facts.port, { value: 8080, source: 'rule', from: 'EXPOSE 8080 in the Dockerfile' });
    assert.ok(!r.assumptions.some((a) => /listens on \$PORT/.test(a)), 'no default-port assumption left');
  });

  it('a Python repo with a kept Dockerfile uses its port too, not 8000', async () => {
    await put('Dockerfile', 'FROM python:3.12-slim\nARG APP_PORT=5050\nEXPOSE ${APP_PORT}\n');
    await put('requirements.txt', 'flask\n');
    await put('app.py', 'from flask import Flask\napp = Flask(__name__)\n');
    const r = await detectStack(dir);
    assert.equal(r.port, 5050);
    assert.equal(r.facts.port.from, 'EXPOSE ${APP_PORT} in the Dockerfile');
  });

  it('falls back to the stack default, said as an assumption, when the port is unreadable', async () => {
    await put('Dockerfile', 'FROM node:22\nEXPOSE $PORT\n');
    await put('package.json', '{}');
    const r = await detectStack(dir);
    assert.equal(r.port, 3000);
    assert.equal(r.facts.port.source, 'default');
    assert.match(r.assumptions.join(' '), /no EXPOSE \(or PORT\) Kairo could read, so Kairo assumed port 3000 and injects PORT=3000/);
  });
});

describe('dockerfilePort()', () => {
  const cases = [
    ['FROM n\nEXPOSE 8080\n', 8080],
    ['FROM n AS build\nEXPOSE 3000\nFROM n\nEXPOSE 9000/tcp 9100\n', 9000],
    ['FROM n\nARG P=5050\nEXPOSE ${P}\n', 5050],
    ['FROM n\nEXPOSE ${P:-6060}\n', 6060],
    ['FROM n\nENV PORT 7000\n', 7000],
    ['FROM n\nENV A=1 PORT=7100\n', 7100],
    ['FROM n\nEXPOSE \\\n  4321\n', 4321],
    ['FROM n\nEXPOSE 53/udp\n', null],
    ['FROM n\n# EXPOSE 1234\n', null],
    ['FROM n\nEXPOSE $PORT\n', null],
    ['FROM n\nEXPOSE 99999\n', null],
    ['FROM n AS build\nEXPOSE 3000\nFROM m\nCMD x\n', null],
  ];
  for (const [text, want] of cases) {
    it(`${JSON.stringify(text)} -> ${want}`, () => assert.equal(dockerfilePort(text)?.port ?? null, want));
  }
});

describe('nodeVersion(engines.node)', () => {
  const cases = [
    ['>=18', 22], ['>= 18.0.0', 22], ['>=23', 24], ['>22', 24], ['20.x', 20], ['^20.11.0', 20], ['~18.17', 18],
    ['20', 20], ['v20', 20], ['18 || 20', 20], ['16.x || 18.x', 18], ['*', 22], ['', 22], [undefined, 22],
  ];
  for (const [range, want] of cases) {
    it(`${JSON.stringify(range)} -> ${want}`, () => assert.equal(nodeVersion(range).value, want));
  }

  it('falls back to 22, as a default with a note, for a version with no image', () => {
    const r = nodeVersion('14.x');
    assert.equal(r.value, 22);
    assert.equal(r.source, 'default');
    assert.match(r.note, /14\.x/);
  });
});
