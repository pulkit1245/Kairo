import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probeFailureText, troubleFrom } from '../../src/kubernetes/k8s.client.js';

// A failed run at DEPLOYING says why the pod isn't ready. A failing health
// check shows only as a pod event, so the events are read (P5f, #10 Django).

const pod = (name, cs = {}, phase = 'Running') => ({ metadata: { name }, status: { phase, containerStatuses: [{ name: 'app', ...cs }] } });
const unhealthy = (podName, message, t = '2026-11-19T10:10:00Z') => ({ involvedObject: { kind: 'Pod', name: podName }, reason: 'Unhealthy', message, lastTimestamp: t });

test('each probe failure the kubelet reports reads in plain words', () => {
  assert.equal(probeFailureText('Readiness probe failed: HTTP probe failed with statuscode: 400'), 'Health check got HTTP 400 from the app');
  assert.equal(probeFailureText('Liveness probe failed: HTTP probe failed with statuscode: 503'), 'Health check got HTTP 503 from the app');
  assert.equal(
    probeFailureText('Liveness probe failed: Get "http://10.1.0.110:8000/": dial tcp 10.1.0.110:8000: connect: connection refused'),
    "Health check couldn't connect: nothing is listening on the app's port",
  );
  assert.equal(
    probeFailureText('Readiness probe failed: Get "http://10.1.0.110:8000/": context deadline exceeded (Client.Timeout exceeded while awaiting headers)'),
    "Health check timed out: the app didn't answer in time",
  );
  assert.equal(probeFailureText('Liveness probe failed: Get "http://10.1.0.110:8000/": read tcp 10.1.0.1:4321->10.1.0.110:8000: read: connection reset by peer'), 'The app closed the health check connection without answering');
  assert.equal(probeFailureText('Readiness probe failed: Get "http://10.1.0.110:8000/": EOF'), 'The app closed the health check connection without answering');
  assert.equal(probeFailureText('Startup probe failed: something new'), 'Health check failed: something new');
  assert.equal(probeFailureText('Back-off restarting failed container'), null);
  assert.equal(probeFailureText(undefined), null);
});

test("#10's case: Django answers 400, the kubelet restarts it, the last exit is Completed", () => {
  const pods = [pod('web-1', { state: { running: {} }, lastState: { terminated: { reason: 'Completed', exitCode: 0 } }, restartCount: 3 })];
  const events = [
    unhealthy('web-1', 'Liveness probe failed: HTTP probe failed with statuscode: 400', '2026-11-19T10:10:00Z'),
    { involvedObject: { kind: 'Pod', name: 'web-1' }, reason: 'Killing', message: 'Container app failed liveness probe, will be restarted' },
  ];
  assert.equal(troubleFrom(pods, events), 'Health check got HTTP 400 from the app; Kubernetes restarted it 3 times');
  // without the events (no RBAC yet): the old wording, never an error
  assert.equal(troubleFrom(pods, []), 'last exit: Completed');
});

test('the newest probe failure of the pod wins; other pods and other kinds are ignored', () => {
  const pods = [pod('web-1', { state: { running: {} }, restartCount: 0 })];
  const events = [
    unhealthy('web-1', 'Readiness probe failed: Get "http://x/": dial tcp x: connect: connection refused', '2026-11-19T10:00:00Z'),
    unhealthy('web-1', 'Readiness probe failed: HTTP probe failed with statuscode: 404', '2026-11-19T10:01:00Z'),
    unhealthy('other-pod', 'Readiness probe failed: HTTP probe failed with statuscode: 500', '2026-11-19T10:02:00Z'),
    { involvedObject: { kind: 'Deployment', name: 'web-1' }, reason: 'Unhealthy', message: 'Readiness probe failed: HTTP probe failed with statuscode: 418' },
  ];
  assert.equal(troubleFrom(pods, events), 'Health check got HTTP 404 from the app');
});

test('a crash, an image problem or running out of memory still says so, even with probe events', () => {
  const refused = [unhealthy('web-1', 'Readiness probe failed: Get "http://x/": dial tcp x: connect: connection refused')];
  const crash = [pod('web-1', { state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'Error', exitCode: 1 } }, restartCount: 4 })];
  assert.equal(troubleFrom(crash, refused), 'CrashLoopBackOff');
  const image = [pod('web-1', { state: { waiting: { reason: 'ErrImageNeverPull' } } })];
  assert.equal(troubleFrom(image, refused), 'ErrImageNeverPull');
  const oom = [pod('web-1', { state: { running: {} }, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } } })];
  assert.equal(troubleFrom(oom, refused), 'last exit: OOMKilled');
});

test('nothing to go on: the old answers', () => {
  assert.equal(troubleFrom([], []), 'no pods');
  assert.equal(troubleFrom([pod('web-1', { state: { running: {} } })], []), 'not ready');
  assert.equal(troubleFrom([pod('web-1', {}, 'Pending')], []), 'pod is Pending');
  // a probe event for a pod with no container status yet
  assert.equal(troubleFrom([{ metadata: { name: 'web-1' }, status: { phase: 'Running' } }], [unhealthy('web-1', 'Readiness probe failed: HTTP probe failed with statuscode: 400')]), 'Health check got HTTP 400 from the app');
});
