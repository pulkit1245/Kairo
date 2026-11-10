import { env } from '../config/env.config.js';
import { isAllowed, parseCookies, SESSION_COOKIE, verifySession } from '../utils/session.js';

// Reads the session cookie into req.user ({ id, login }), or leaves it unset.
export function readSession(req, _res, next) {
  const payload = verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE], env.sessionSecret);
  // the allow-list is checked on every request, not just at sign-in (FR-2)
  if (payload && isAllowed(payload.login, env.allowedLogins)) {
    req.user = { id: payload.uid, login: payload.login };
  }
  next();
}

// FR-42: every endpoint needs sign-in, except POST /api/alerts (bearer token)
// and the sign-in routes themselves. app.js mounts those before this.
export function requireSession(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: env.sessionSecret ? 'Sign in first' : 'Sign-in is not set up on this Kairo (SESSION_SECRET)' });
}
