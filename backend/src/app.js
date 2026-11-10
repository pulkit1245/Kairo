import cors from 'cors';
import express from 'express';
import { env } from './config/env.config.js';
import { errorHandler, notFound } from './middlewares/error.middleware.js';
import { requestLogger } from './middlewares/logger.middleware.js';
import { readSession, requireSession } from './middlewares/session.middleware.js';
import alertRouter from './routes/alert.routes.js';
import authRouter from './routes/auth.routes.js';
import deploymentRouter from './routes/deployment.routes.js';
import healthRouter from './routes/health.routes.js';
import incidentRouter from './routes/incident.routes.js';
import { appRouter, repoRouter } from './routes/repo.routes.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigin }));
  // before express.json so requests with broken JSON still get logged
  app.use(requestLogger);
  app.use(express.json({ limit: '1mb' }));
  app.use(readSession);

  // express 5 passes rejected promises from async handlers to the error
  // middleware by itself, so no asyncHandler wrapper needed

  // open (FR-42): sign-in itself, and the Alertmanager webhook with its own token
  app.use('/api/auth', authRouter);
  app.use('/api/alerts', alertRouter);

  // everything else needs a signed-in, allow-listed user
  app.use('/api', requireSession);
  app.use('/api/health', healthRouter);
  app.use('/api/repos', repoRouter);
  app.use('/api/apps', appRouter);
  // the P1 repo-URL entry point: a testing shortcut now, hidden from the UI (AQ10)
  app.use('/api/deployments', deploymentRouter);
  app.use('/api/incidents', incidentRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
