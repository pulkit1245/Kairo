import { createLogger } from '../utils/logger.js';

const log = createLogger('http');

export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    // the frontend polls these every second or two, logging them is just noise
    if (req.method === 'GET' && res.statusCode < 400) {
      log.debug(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
      return;
    }
    log.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
}
