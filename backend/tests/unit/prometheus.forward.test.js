import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { env } from '../../src/config/env.config.js';
import {
  _check, _reset, _setDeps, _state, forwardArgs, localTarget, prometheusForwardState, startPrometheusForward, stopPrometheusForward, timing,
} from '../../src/prometheus/forward.service.js';

// The backend's own port-forward to Prometheus (FR-57). kubectl is never run
// here: spawn and the readiness check are fakes.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const saved = { ...timing };
const savedEnv = { url: env.prometheusUrl, on: env.prometheusForward };

function fakeKubectl() {
  const procs = [];
  const spawn = (cmd, args) => {
    const p = new EventEmitter();
    p.cmd = cmd;
    p.args = args;
    p.stdout = new PassThrough();
    p.stderr = new PassThrough();
    p.killed = null;
    p.kill = (sig) => {
      p.killed = sig;
      setImmediate(() => p.emit('exit', null, sig));
    };
    procs.push(p);
    return p;
  };
  return { procs, spawn };
}

let up;
beforeEach(() => {
  Object.assign(timing, { checkMs: 60_000, startGraceMs: 0, backoffStartMs: 20, backoffMaxMs: 80, readyTimeoutMs: 50 });
  _reset(); // after the timings, so the first wait is the short one
  Object.assign(env, { prometheusUrl: 'http://localhost:9090', prometheusForward: true });
  up = false;
});
afterEach(() => {
  stopPrometheusForward();
  _setDeps();
  Object.assign(timing, saved);
  Object.assign(env, { prometheusUrl: savedEnv.url, prometheusForward: savedEnv.on });
});

describe('Prometheus port-forward (FR-57)', () => {
  it('opens a forward bound to 127.0.0.1 when Prometheus does not answer', async () => {
    const k = fakeKubectl();
    _setDeps({ spawn: k.spawn, ready: async () => up });
    await startPrometheusForward();
    assert.equal(k.procs.length, 1);
    assert.equal(k.procs[0].cmd, env.kubectlPath);
    assert.deepEqual(k.procs[0].args, ['-n', 'monitoring', 'port-forward', 'svc/prometheus-server', '9090:80', '--address', '127.0.0.1']);
    up = true;
    await _check(9090);
    assert.equal(prometheusForwardState().state, 'up');
  });

  it('uses a forward that already answers, and opens its own when that one goes', async () => {
    const k = fakeKubectl();
    up = true;
    _setDeps({ spawn: k.spawn, ready: async () => up });
    await startPrometheusForward();
    assert.equal(k.procs.length, 0);
    assert.equal(prometheusForwardState().state, 'external');
    up = false;
    await _check(9090);
    assert.equal(k.procs.length, 1);
  });

  it('starts kubectl again when it exits (Docker Desktop restarting), waiting longer each time up to the cap', async () => {
    const k = fakeKubectl();
    _setDeps({ spawn: k.spawn, ready: async () => up });
    await startPrometheusForward();
    for (let i = 0; i < 4; i++) {
      k.procs.at(-1).stderr.write('error: connection refused\n');
      k.procs.at(-1).emit('exit', 1, null);
      await wait(100);
    }
    assert.equal(k.procs.length, 5);
    assert.equal(prometheusForwardState().restarts, 4);
    assert.equal(_state.backoff, 80, 'the wait grew 20, 40, 80 and stays at the cap');
    // back to normal once Prometheus answers
    up = true;
    await _check(9090);
    assert.equal(_state.backoff, 20);
  });

  it('kills a forward that runs but no longer forwards (Prometheus pod restarted), then opens a new one', async () => {
    const k = fakeKubectl();
    _setDeps({ spawn: k.spawn, ready: async () => up });
    await startPrometheusForward();
    up = true;
    await _check(9090);
    up = false;
    await _check(9090); // one miss: wait
    assert.equal(k.procs[0].killed, null);
    await _check(9090); // two in a row: restart
    assert.equal(k.procs[0].killed, 'SIGTERM');
    await wait(60);
    assert.equal(k.procs.length, 2);
  });

  it('stops for good on shutdown', async () => {
    const k = fakeKubectl();
    _setDeps({ spawn: k.spawn, ready: async () => up });
    await startPrometheusForward();
    stopPrometheusForward();
    assert.equal(k.procs[0].killed, 'SIGTERM');
    await wait(60);
    assert.equal(k.procs.length, 1, 'no new forward after shutdown');
    assert.equal(prometheusForwardState().state, 'off');
  });

  it('does nothing when switched off or when Prometheus is elsewhere', async () => {
    const k = fakeKubectl();
    _setDeps({ spawn: k.spawn, ready: async () => false });
    env.prometheusForward = false;
    await startPrometheusForward();
    env.prometheusForward = true;
    env.prometheusUrl = 'http://prometheus.example:9090';
    await startPrometheusForward();
    assert.equal(k.procs.length, 0);
    assert.equal(localTarget('http://127.0.0.1:9191').port, 9191);
    assert.equal(localTarget('http://prom.internal:9090'), null);
    assert.deepEqual(forwardArgs(9191).slice(-3), ['9191:80', '--address', '127.0.0.1']);
  });
});
