import { createApp } from './app.js';
import { env } from './config/env.config.js';
import { failInterruptedDeployments } from './generator/pipeline.service.js';
import { prisma } from './db/index.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('server');

async function main() {
  try {
    const stuck = await failInterruptedDeployments();
    if (stuck > 0) log.warn(`marked ${stuck} half-finished deployment(s) as FAILED`);
  } catch (err) {
    // most likely postgres isn't running. still start so /api/health can say so
    log.error('could not reach the database on startup', err);
  }

  const server = createApp().listen(env.port, () => {
    log.info(`kairo api listening on http://localhost:${env.port}`);
    if (env.remediationDryRun) log.info('remediation is in DRY RUN mode');
  });

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
