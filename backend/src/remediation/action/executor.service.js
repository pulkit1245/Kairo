import { env } from '../../config/env.config.js';
import { deletePod } from '../../kubernetes/k8s.client.js';
import { errorMessage } from '../../utils/AppError.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('remediation');

export async function executeAction(action, alert) {
  if (action === 'NONE') {
    return { executed: false, note: 'no action for this alert' };
  }

  if (env.remediationDryRun) {
    log.info(`[dry run] would ${action} ${alert.appName} (pod ${alert.pod ?? '?'})`);
    return { executed: false, note: 'dry run' };
  }

  switch (action) {
    case 'RESTART':
      return restartPod(alert);
    case 'ROLLBACK':
    case 'SCALE':
      // TODO(phase 2): rollback = patch deployment back to previous ReplicaSet's template,
      // scale = bump replicas (with a cap so a bad alert can't eat the cluster)
      log.warn(`${action} not implemented yet, skipping for ${alert.appName}`);
      return { executed: false, note: `${action} not implemented yet` };
    default:
      log.warn(`unknown action "${action}" for ${alert.appName}`);
      return { executed: false, note: 'unknown action' };
  }
}

async function restartPod(alert) {
  if (!alert.pod) {
    return { executed: false, note: 'alert has no pod label, nothing to restart' };
  }

  const namespace = alert.namespace ?? env.kubeNamespace;
  try {
    await deletePod(namespace, alert.pod);
    log.info(`restarted ${namespace}/${alert.pod}`);
    return { executed: true, note: `deleted pod ${alert.pod}` };
  } catch (err) {
    // pod is often already gone by the time the alert arrives (k8s restarted it
    // itself). that's fine, not an error worth failing the webhook over
    log.warn(`could not delete ${namespace}/${alert.pod}: ${errorMessage(err)}`);
    return { executed: false, note: 'pod delete failed' };
  }
}
