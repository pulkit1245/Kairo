import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideAction } from '../../src/remediation/action/decision.service.js';
import { parseAlerts } from '../../src/remediation/alert/alert.service.js';

// trimmed down from a real alertmanager webhook call
const payload = {
  version: '4',
  status: 'firing',
  receiver: 'kairo',
  alerts: [
    {
      status: 'firing',
      labels: {
        alertname: 'KairoAppDown',
        namespace: 'kairo-apps',
        pod: 'hello-node-7d9f-abcde',
        deployment: 'hello-node',
      },
      annotations: { summary: 'hello-node is not responding' },
      startsAt: '2026-09-29T10:00:00Z',
      endsAt: '0001-01-01T00:00:00Z',
      fingerprint: 'f1',
    },
    {
      status: 'resolved',
      labels: { alertname: 'KairoHighCpu', app: 'other-app' },
      annotations: {},
      startsAt: '2026-09-29T10:00:00Z',
      endsAt: '2026-09-29T10:00:12Z',
      fingerprint: 'f2',
    },
    {
      status: 'firing',
      labels: { alertname: 'Watchdog' },
      annotations: {},
      startsAt: '2026-09-29T10:00:00Z',
      endsAt: '0001-01-01T00:00:00Z',
      fingerprint: 'f3',
    },
  ],
};

describe('parseAlerts', () => {
  const { alerts, skipped } = parseAlerts(payload);

  it('skips alerts that are not about an app', () => {
    assert.equal(alerts.length, 2);
    assert.equal(skipped, 1);
  });

  it('reads the app name from the deployment label', () => {
    assert.equal(alerts[0]?.appName, 'hello-node');
    assert.equal(alerts[0]?.pod, 'hello-node-7d9f-abcde');
  });

  it('treats the zero date as "still firing"', () => {
    assert.equal(alerts[0]?.endsAt, null);
    assert.equal(alerts[1]?.endsAt?.toISOString(), '2026-09-29T10:00:12.000Z');
    assert.equal(alerts[1]?.firing, false);
  });
});

describe('decideAction', () => {
  it('restarts on app down', () => {
    assert.equal(decideAction('KairoAppDown').action, 'RESTART');
  });

  it('rolls back a crashloop', () => {
    assert.equal(decideAction('KairoCrashLoop').action, 'ROLLBACK');
  });

  it('does nothing for alerts it does not know', () => {
    const rule = decideAction('SomethingElse', 'disk is full');
    assert.equal(rule.action, 'NONE');
    assert.equal(rule.cause, 'disk is full');
  });
});
