import { createApp } from './app.js';
import { env, githubConfigured } from './config/env.config.js';
import { emptyWorkspace, failInterruptedRuns } from './generator/pipeline.service.js';
import {
  FLUSH_INTERVAL_MS,
  flushUnsaved,
  rebuildIncidentState,
} from './remediation/incident/incident.service.js';
import { prisma } from './db/index.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('server');

async function main() {
  try {
    const stuck = await failInterruptedRuns();
    if (stuck > 0) log.warn(`marked ${stuck} half-finished pipeline run(s) as FAILED`);
    // FR-74: healing decides from memory, filled from the database once here
    const state = await rebuildIncidentState();
    log.info(`healing state: ${state.openIncidents} open incident(s), ${state.apps} app(s)`);
  } catch (err) {
    // most likely postgres isn't running. still start so /api/health can say so
    log.error('could not reach the database on startup', err);
  }

  const leftovers = await emptyWorkspace();
  if (leftovers > 0) log.warn(`removed ${leftovers} leftover clone folder(s) from the workspace`);

  const server = createApp().listen(env.port, () => {
    log.info(`kairo api listening on http://localhost:${env.port}`);
    if (env.remediationDryRun) log.info('remediation is in DRY RUN mode');
    if (!env.alertWebhookToken) log.warn('ALERT_WEBHOOK_TOKEN is not set: every /api/alerts call will get 401');
    if (!githubConfigured()) log.warn('the GitHub App is not configured (GITHUB_APP_*, GITHUB_CLIENT_*): sign-in is off');
    if (!env.sessionSecret) log.warn('SESSION_SECRET is not set: nobody can sign in');
    if (env.allowedLogins.size === 0) log.warn('ALLOWED_GITHUB_LOGINS is empty: everyone will see "Not invited"');
  });

  // incident writes that failed during a database outage are saved once it's back (FR-74)
  const flushTimer = setInterval(() => {
    flushUnsaved().catch((err) => log.error('flushing unsaved incidents failed', err));
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref();

  const shutdown = (signal) => {
    log.info(`${signal} received, shutting down`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    // don't hang forever on a stuck keep-alive connection
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
