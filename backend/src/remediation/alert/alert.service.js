// Alertmanager POSTs { version: "4", status, receiver, alerts: [...] } to a webhook receiver.
// Each alert has status, labels, annotations, startsAt, endsAt, fingerprint.
// https://prometheus.io/docs/alerting/latest/configuration/#webhook_config

/**
 * What the rest of remediation/ works with, after parseAlerts() cleans it up.
 * @typedef {object} KairoAlert
 * @property {string} fingerprint
 * @property {boolean} firing
 * @property {string} alertName
 * @property {string} appName
 * @property {string | null} namespace
 * @property {string | null} pod
 * @property {string} summary
 * @property {Date} startsAt
 * @property {Date | null} endsAt   alertmanager sends "0001-01-01T00:00:00Z" while still firing, we turn that into null
 */

export function isAlertmanagerPayload(body) {
  return typeof body === 'object' && body !== null && Array.isArray(body.alerts);
}

export function parseAlerts(payload) {
  const alerts = [];
  let skipped = 0;

  for (const a of payload.alerts) {
    const labels = a.labels ?? {};
    // kube-state-metrics based rules usually give us `pod`/`deployment`/`container`
    // rather than `app`, so try all of them
    const appName = labels.app ?? labels.deployment ?? labels.container;

    if (!labels.alertname || !appName || !a.fingerprint) {
      skipped++;
      continue;
    }

    alerts.push({
      fingerprint: a.fingerprint,
      firing: a.status === 'firing',
      alertName: labels.alertname,
      appName,
      namespace: labels.namespace ?? null,
      pod: labels.pod ?? null,
      summary: a.annotations?.summary ?? a.annotations?.description ?? labels.alertname,
      startsAt: new Date(a.startsAt),
      endsAt: parseEndsAt(a.endsAt),
    });
  }

  return { alerts, skipped };
}

function parseEndsAt(value) {
  if (!value || value.startsWith('0001-')) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
