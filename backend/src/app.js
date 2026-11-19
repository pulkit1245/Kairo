import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { env } from './config/env.config.js';
import { errorHandler, notFound } from './middlewares/error.middleware.js';
import { requestLogger } from './middlewares/logger.middleware.js';
import { createLogger } from './utils/logger.js';
import { readSession, requireSession } from './middlewares/session.middleware.js';
import alertRouter from './routes/alert.routes.js';
import authRouter from './routes/auth.routes.js';
import deploymentRouter from './routes/deployment.routes.js';
import healthRouter from './routes/health.routes.js';
import incidentRouter from './routes/incident.routes.js';
import { appRouter, repoRouter } from './routes/repo.routes.js';

const log = createLogger('server');

// frontendDist: the built dashboard to serve, or null (development: Vite serves it)
export function createApp({ frontendDist = env.serveFrontend ? env.frontendDist : null } = {}) {
  const app = express();
  // cloudflared reaches the backend from this Mac over http: trust its
  // X-Forwarded-* headers (and only from loopback), so req.protocol is https
  app.set('trust proxy', 'loopback');

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

  // P6: the built dashboard, and index.html for its own routes (/apps/…), so a
  // reload or a link from a GitHub issue opens the right page
  if (frontendDist) {
    const index = path.join(frontendDist, 'index.html');
    if (!existsSync(index)) log.warn(`SERVE_FRONTEND is on but ${index} is missing: run npm run build in frontend/`);
    app.use(express.static(frontendDist, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/')) return next();
      res.sendFile(index, (err) => err && next());
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
