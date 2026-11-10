import { env } from '../../config/env.config.js';
import { deletePod } from '../../kubernetes/k8s.client.js';
import { errorMessage } from '../../utils/AppError.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('remediation');

// Runs one action and says how it went, in the words a RemediationAttempt uses:
// { result: 'APPLIED' | 'FAILED' | 'SKIPPED', dryRun, note }
// VERIFIED / UNVERIFIED come later, from the check after the action (P3)
export async function executeAction(action, alert) {
  const dryRun = env.remediationDryRun;
  const skipped = (note) => ({ result: 'SKIPPED', dryRun, note });

  if (action === 'NONE') return skipped('no action for this alert');

  if (dryRun) {
    log.info(`[dry run] would ${action} ${alert.appName} (pod ${alert.pod ?? '?'})`);
    return skipped('dry run');
  }

  switch (action) {
    case 'RESTART':
      return restartPod(alert, dryRun);
    case 'ROLLBACK':
    case 'SCALE_UP':
    case 'SCALE_DOWN':
      // TODO(P3): rollback = patch the deployment to the last healthy release's image,
      // scale = change replicas within the cap of 3
      log.warn(`${action} not implemented yet, skipping for ${alert.appName}`);
      return skipped(`${action} not implemented yet`);
    default:
      log.warn(`unknown action "${action}" for ${alert.appName}`);
      return skipped('unknown action');
  }
}

async function restartPod(alert, dryRun) {
  if (!alert.pod) {
    return { result: 'SKIPPED', dryRun, note: 'alert has no pod label, nothing to restart' };
  }

  const namespace = alert.namespace ?? env.kubeNamespace;
  try {
    await deletePod(namespace, alert.pod);
    log.info(`restarted ${namespace}/${alert.pod}`);
    return { result: 'APPLIED', dryRun, note: `deleted pod ${alert.pod}` };
  } catch (err) {
    // pod is often already gone by the time the alert arrives (k8s restarted it
    // itself). logged as a warning, recorded as FAILED so the record is honest
    log.warn(`could not delete ${namespace}/${alert.pod}: ${errorMessage(err)}`);
    return { result: 'FAILED', dryRun, note: 'pod delete failed' };
  }
}
