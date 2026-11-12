import { env } from '../config/env.config.js';
import { geminiStatus } from '../gemini/gemini.client.js';
import { pingCluster } from '../kubernetes/k8s.client.js';
import { prisma } from '../db/index.js';
import { prometheusForwardState } from '../prometheus/forward.service.js';

async function dbUp() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// the api itself answering means it's "up" - db and cluster are reported
// separately so the dashboard can show which piece is missing
export async function health(_req, res) {
  const [db, cluster] = await Promise.all([dbUp(), pingCluster()]);
  res.json({
    ok: true,
    db: db ? 'up' : 'down',
    cluster: cluster ? 'up' : 'down',
    // true = healing records incidents but never touches pods (REMEDIATION_DRY_RUN)
    dryRun: env.remediationDryRun,
    // the last Gemini call's outcome: off, up, down or unknown (none yet)
    gemini: geminiStatus(),
    // the port-forward to Prometheus the backend keeps open (FR-57)
    prometheus: prometheusForwardState(),
  });
}
