import { createLogger } from '../utils/logger.js';

const log = createLogger('http');

export function requestLogger(req, res, next) {
  const start = Date.now();
  // path only: GitHub's callback carries a one-time code in the query string
  // (and nothing else in Kairo's query strings is worth a log line)
  const url = req.originalUrl.split('?')[0];
  res.on('finish', () => {
    // the frontend polls these every second or two, logging them is just noise
    if (req.method === 'GET' && res.statusCode < 400) {
      log.debug(`${req.method} ${url} ${res.statusCode} ${Date.now() - start}ms`);
      return;
    }
    log.info(`${req.method} ${url} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
}
