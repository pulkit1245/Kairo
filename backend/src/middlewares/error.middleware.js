import { AppError, isDatabaseDown, shortError } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('http');

export function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

// express knows this is an error handler because it takes 4 args,
// so _next has to stay even though it's unused
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // body-parser errors (bad JSON etc.) come with their own status
  const status = err.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: err.message });
    return;
  }

  // Postgres stopped: say so in one line instead of a stack trace on every poll
  if (isDatabaseDown(err)) {
    log.warn(`${req.method} ${req.path}: database not reachable (${shortError(err)})`);
    res.status(503).json({ error: 'The database is not reachable' });
    return;
  }

  log.error(`${req.method} ${req.path} failed`, err);
  res.status(500).json({ error: 'Something went wrong on our side' });
}
