import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../../src/app.js';

// P6: one public address. The backend serves the built dashboard itself, so a
// Cloudflare tunnel to the backend carries both the pages and /api.

const dist = mkdtempSync(path.join(os.tmpdir(), 'kairo-dist-'));
mkdirSync(path.join(dist, 'assets'));
writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Kairo</title>');
writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');

const listen = async (app) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};

describe('serving the built frontend', () => {
  let on, off;
  before(async () => {
    on = await listen(createApp({ frontendDist: dist }));
    off = await listen(createApp({ frontendDist: null }));
  });
  after(() => {
    on.server.close();
    off.server.close();
  });

  it('serves index.html at / and on the dashboard routes', async () => {
    for (const p of ['/', '/apps/kairo-node-sample', '/apps/kairo-node-sample/incidents/abc']) {
      const res = await fetch(`${on.base}${p}`);
      assert.equal(res.status, 200, p);
      assert.match(await res.text(), /<title>Kairo<\/title>/, p);
    }
  });

  it('serves the built files', async () => {
    const res = await fetch(`${on.base}/assets/app.js`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'console.log(1)');
  });

  it('leaves /api alone: no page for an unknown API path, sign-in still required', async () => {
    const unknown = await fetch(`${on.base}/api/nope`);
    assert.equal(unknown.status, 401);
    assert.match(unknown.headers.get('content-type'), /json/);
    const apps = await fetch(`${on.base}/api/apps`);
    assert.equal(apps.status, 401);
  });

  it('is off by default (development: Vite serves the pages)', async () => {
    const res = await fetch(`${off.base}/apps/kairo-node-sample`);
    assert.equal(res.status, 404);
  });

  it('trusts X-Forwarded-Proto from cloudflared on this machine only', async () => {
    assert.equal(createApp({ frontendDist: null }).get('trust proxy fn')('127.0.0.1'), true);
    assert.equal(createApp({ frontendDist: null }).get('trust proxy fn')('203.0.113.9'), false);
  });
});
