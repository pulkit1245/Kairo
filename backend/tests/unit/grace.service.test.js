import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { _resetGrace, GRACE_MS, inGrace, startGrace, stopGrace } from '../../src/shipping/grace.service.js';
import { every } from '../../src/jobs/scheduler.js';

afterEach(() => _resetGrace());

describe('grace window (FR-71)', () => {
  const app = { id: 'a1', slug: 'demo', namespace: 'kairo-demo' };

  it('lasts 60 s from the release going live', () => {
    const deployedAt = new Date('2026-11-10T12:00:00Z');
    const now = deployedAt.getTime();
    startGrace({ id: 'r1', imageRef: 'x', deployedAt }, app, now);
    assert.equal(GRACE_MS, 60_000);
    assert.equal(inGrace('demo', now + 59_000), true);
    assert.equal(inGrace('demo', now + 60_000), false);
    assert.equal(inGrace('other', now), false);
  });

  it('a newer release replaces the window, stopping ends it', () => {
    const t = Date.now();
    startGrace({ id: 'r1', imageRef: 'x', deployedAt: new Date(t - 50_000) }, app, t);
    startGrace({ id: 'r2', imageRef: 'y', deployedAt: new Date(t) }, app, t);
    assert.equal(inGrace('demo', t + 30_000), true);
    stopGrace('demo');
    assert.equal(inGrace('demo', t), false);
  });
});

describe('scheduler', () => {
  it('skips a tick while the previous one still runs', async () => {
    let started = 0;
    let release;
    const timer = every('test', 5, async () => {
      started++;
      await new Promise((r) => (release = r));
    });
    await new Promise((r) => setTimeout(r, 40));
    clearInterval(timer);
    assert.equal(started, 1);
    release();
  });
});
