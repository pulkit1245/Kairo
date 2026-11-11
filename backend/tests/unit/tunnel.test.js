import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { prisma } from '../../src/db/index.js';
import * as tunnel from '../../src/tunnel/tunnel.service.js';

// A fake cloudflared: prints what the real one prints, dies when told to
function fakeProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    setImmediate(() => child.emit('exit', null, 'SIGTERM'));
  };
  child.say = (line) => child.stderr.write(`2026-11-11T13:33:44Z INF ${line}\n`);
  child.comeUp = (name) => {
    child.say(`|  https://${name}.trycloudflare.com                                       |`);
    child.say('Registered tunnel connection connIndex=0 location=del01 protocol=quic');
  };
  return child;
}

const until = async (test, ms = 1000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

let spawned;
let saved;
const original = prisma.app.updateMany;

beforeEach(() => {
  spawned = [];
  saved = [];
  tunnel._setSpawn((bin, args) => {
    const child = fakeProcess();
    child.args = args;
    spawned.push(child);
    return child;
  });
  tunnel._setTiming({ restartDelayMs: 20, maxRestartDelayMs: 80, readyWithinMs: 200, stableAfterMs: 60_000 });
  prisma.app.updateMany = async (args) => (saved.push(args.data.publicUrl), { count: 1 });
});
afterEach(() => {
  tunnel._reset();
  tunnel._setSpawn(null);
  prisma.app.updateMany = original;
});

const APP = { id: 'a1', slug: 'demo' };

describe('the public link (FR-40, FR-41)', () => {
  it('points cloudflared at Traefik with the app host header', () => {
    tunnel.startTunnel(APP);
    const args = spawned[0].args;
    assert.equal(args[args.indexOf('--http-host-header') + 1], 'demo.kairo.local');
    assert.match(args[args.indexOf('--url') + 1], /^http:\/\/localhost/);
  });

  it('saves the link once the tunnel is connected, not when it is first printed', async () => {
    tunnel.startTunnel(APP);
    spawned[0].say('|  https://first-words-here.trycloudflare.com   |');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(saved, []);
    assert.equal(tunnel.tunnelState('demo'), 'starting');
    spawned[0].say('Registered tunnel connection connIndex=0');
    await until(() => saved.length === 1);
    assert.deepEqual(saved, ['https://first-words-here.trycloudflare.com']);
    assert.equal(tunnel.tunnelState('demo'), 'up');
  });

  it('starts one tunnel per app', () => {
    tunnel.startTunnel(APP);
    tunnel.startTunnel(APP);
    assert.equal(spawned.length, 1);
  });

  it('restarts a tunnel that dies and saves the new link', async () => {
    tunnel.startTunnel(APP);
    spawned[0].comeUp('old-link');
    await until(() => saved.length === 1);
    spawned[0].emit('exit', 1, null);
    // the dead link is cleared at once
    await until(() => saved.length === 2);
    assert.equal(saved[1], null);
    assert.equal(tunnel.tunnelState('demo'), 'restarting');
    await until(() => spawned.length === 2);
    spawned[1].comeUp('new-link');
    await until(() => saved.length === 3);
    assert.equal(saved[2], 'https://new-link.trycloudflare.com');
  });

  it('waits longer each time it keeps dying, never past the cap', async () => {
    tunnel.startTunnel(APP);
    const gaps = [];
    for (let i = 0; i < 4; i++) {
      const before = Date.now();
      spawned[i].emit('exit', 1, null);
      await until(() => spawned.length === i + 2);
      gaps.push(Date.now() - before);
    }
    // 20, 40, 80, 80 ms
    assert.ok(gaps[1] > gaps[0] && gaps[2] > gaps[1], gaps.join(', '));
    assert.ok(gaps[3] < 160, gaps.join(', '));
  });

  it('kills and restarts a tunnel that never connects', async () => {
    tunnel.startTunnel(APP);
    spawned[0].say('Requesting new quick Tunnel on trycloudflare.com...');
    await until(() => spawned[0].killed, 1000);
    await until(() => spawned.length === 2, 1000);
  });

  it('a stopped tunnel is not restarted (delete, shutdown)', async () => {
    tunnel.startTunnel(APP);
    spawned[0].comeUp('a-link');
    await until(() => saved.length === 1);
    assert.equal(tunnel.stopTunnel('demo'), true);
    assert.equal(spawned[0].killed, true);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(spawned.length, 1);
    assert.equal(tunnel.tunnelState('demo'), null);
    assert.equal(tunnel.stopTunnel('demo'), false);
  });

  it('gives up quietly when cloudflared is not installed', async () => {
    tunnel.startTunnel(APP);
    spawned[0].emit('error', Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' }));
    assert.equal(tunnel.tunnelState('demo'), null);
    tunnel.startTunnel({ id: 'a2', slug: 'other' });
    assert.equal(spawned.length, 1);
  });
});
