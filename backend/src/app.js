import cors from 'cors';
import express from 'express';
import { env } from './config/env.config.js';
import { errorHandler, notFound } from './middlewares/error.middleware.js';
import { requestLogger } from './middlewares/logger.middleware.js';
import alertRouter from './routes/alert.routes.js';
import deploymentRouter from './routes/deployment.routes.js';
import healthRouter from './routes/health.routes.js';
import incidentRouter from './routes/incident.routes.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigin }));
  // before express.json so requests with broken JSON still get logged
  app.use(requestLogger);
  app.use(express.json({ limit: '1mb' }));

  // express 5 passes rejected promises from async handlers to the error
  // middleware by itself, so no asyncHandler wrapper needed
  app.use('/api/health', healthRouter);
  app.use('/api/deployments', deploymentRouter);
  app.use('/api/alerts', alertRouter);
  app.use('/api/incidents', incidentRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
