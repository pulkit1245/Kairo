import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { detectStack } from '../../src/generator/detection/detection.service.js';

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
    const result = await detectStack(dir);
    assert.deepEqual(result.startCommand, ['node', 'src/app.js']);
  });

  it('rejects a node project it cannot start', async () => {
    await put('package.json', '{}');
    await assert.rejects(detectStack(dir), /no "start" script/);
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
    await assert.rejects(detectStack(dir), /Unsupported project/);
  });
});
