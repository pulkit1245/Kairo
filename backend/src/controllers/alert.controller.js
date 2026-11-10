import { isAlertmanagerPayload, parseAlerts } from '../remediation/alert/alert.service.js';
import { handleAlert } from '../remediation/incident/incident.service.js';
import { AppError, errorMessage } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('alerts');

// Alertmanager webhook receiver. Point alertmanager.yml at
//   http://<backend>:4000/api/alerts
export async function receive(req, res) {
  if (!isAlertmanagerPayload(req.body)) {
    throw new AppError('Not an Alertmanager webhook payload');
  }

  const { alerts, skipped } = parseAlerts(req.body);
  if (skipped > 0) log.warn(`skipped ${skipped} alert(s) with no alertname/app label`);

  // one alert failing shouldn't stop the rest from being handled.
  // sequential on purpose: two alerts for the same pod shouldn't race each other
  // alerts for apps Kairo doesn't know count as skipped too
  let failed = 0;
  let unknownApp = 0;
  for (const alert of alerts) {
    try {
      if ((await handleAlert(alert)) === 'unknown-app') unknownApp++;
    } catch (err) {
      failed++;
      log.error(`failed handling ${alert.alertName} for ${alert.appName}: ${errorMessage(err)}`);
    }
  }

  // always 200 unless the whole thing was garbage - a non-2xx makes
  // alertmanager retry, and we'd just fail the same way again
  res.json({ received: alerts.length - unknownApp, skipped: skipped + unknownApp, failed });
}
