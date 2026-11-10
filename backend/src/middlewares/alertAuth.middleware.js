import { createHash, timingSafeEqual } from 'node:crypto';
import { createLogger } from '../utils/logger.js';

const log = createLogger('alerts');

// FR-45: Alertmanager sends `Authorization: Bearer <token>` with the shared
// token from ALERT_WEBHOOK_TOKEN; anything else gets 401. The backend listens
// beyond localhost (so Alertmanager in the cluster can reach it), which is why
// this endpoint can't be open.
//
// Built as a factory so tests can pass a token. With no token configured,
// every call is refused: an open webhook would let anyone restart pods.
export function requireAlertToken(expected) {
  // compare fixed-length hashes, so the comparison takes the same time
  // whatever the input length, and timingSafeEqual never throws on length
  const digest = (v) => createHash('sha256').update(v).digest();
  const want = expected ? digest(expected) : null;

  return function alertAuth(req, res, next) {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);

    if (want && match && timingSafeEqual(digest(match[1].trim()), want)) return next();

    // never log the header itself, only that it was wrong
    log.warn(`rejected ${req.method} ${req.originalUrl}: ${!want ? 'no token configured' : match ? 'wrong token' : 'no bearer token'}`);
    res.status(401).json({ error: 'Missing or invalid bearer token' });
  };
}
