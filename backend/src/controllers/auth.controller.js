import { env, githubConfigured } from '../config/env.config.js';
import { authorizeUrl, githubErrorMessage, installUrl } from '../github/github.client.js';
import { completeSignIn, currentUser } from '../services/auth.service.js';
import { createLogger } from '../utils/logger.js';
import {
  cookie,
  newState,
  parseCookies,
  sameState,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  signSession,
  STATE_COOKIE,
} from '../utils/session.js';

const log = createLogger('auth');

const secure = env.appUrl.startsWith('https://');
const STATE_TTL_MS = 10 * 60 * 1000;

// Redirects are relative: the browser reaches the API through the same origin
// as the frontend (Vite's proxy in development), so "/" is the frontend.
const fail = (res, reason) => res.redirect(`/signin?error=${reason}`);

function setState(res) {
  const state = newState();
  res.append('Set-Cookie', cookie(STATE_COOKIE, state, { maxAgeMs: STATE_TTL_MS, path: '/api/auth', secure }));
  return state;
}

// GET /api/auth/login -> GitHub's sign-in page
export function login(_req, res) {
  if (!githubConfigured() || !env.sessionSecret) return fail(res, 'not-configured');
  res.redirect(authorizeUrl(setState(res)));
}

// GET /api/auth/install -> the App's install page (signed in only)
export function install(req, res) {
  if (!req.user) return fail(res, 'sign-in-first');
  if (!githubConfigured()) return fail(res, 'not-configured');
  res.redirect(installUrl(setState(res)));
}

// GET /api/auth/callback. GitHub comes back here after sign-in, and after an
// install (the App asks for user authorization during installation, so an
// install return carries a code too, plus installation_id and setup_action).
export async function callback(req, res) {
  const { code, state, installation_id: installationId, setup_action: setupAction, error } = req.query;
  const expected = parseCookies(req.headers.cookie)[STATE_COOKIE];
  res.append('Set-Cookie', cookie(STATE_COOKIE, '', { maxAgeMs: 0, path: '/api/auth', secure }));

  if (!githubConfigured() || !env.sessionSecret) return fail(res, 'not-configured');
  if (error) return fail(res, 'cancelled');
  if (typeof code !== 'string' || !code) return fail(res, 'no-code');

  const installReturn = Boolean(installationId || setupAction);
  if (installReturn) {
    // GitHub doesn't always hand the state back after an install, so here the
    // browser must already be signed in, and the code must belong to that same
    // user (checked below). A forged installation_id can't attach anything:
    // only installations GitHub lists for this user are stored.
    if (!req.user) return fail(res, 'sign-in-first');
    if (state && !sameState(state, expected)) return fail(res, 'state');
  } else if (!sameState(state, expected)) {
    return fail(res, 'state');
  }

  let result;
  try {
    result = await completeSignIn(code);
  } catch (err) {
    log.warn(`sign-in failed: ${githubErrorMessage(err)}`);
    return fail(res, 'github');
  }

  if (result.outcome === 'not-invited') {
    log.info(`${result.login} is not on the allow-list`);
    res.append('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAgeMs: 0, secure }));
    return res.redirect(`/not-invited?login=${encodeURIComponent(result.login)}`);
  }
  if (installReturn && result.user.id !== req.user.id) return fail(res, 'account-mismatch');

  res.append(
    'Set-Cookie',
    cookie(SESSION_COOKIE, signSession({ uid: result.user.id, login: result.user.login }, env.sessionSecret), {
      maxAgeMs: SESSION_TTL_MS,
      secure,
    }),
  );

  if (installReturn) {
    const found = installationId && result.installationIds.includes(Number(installationId));
    log.info(`${result.user.login} came back from GitHub (${setupAction ?? 'install'}), ${result.installationIds.length} installation(s)`);
    return res.redirect(found || !installationId ? '/apps/new' : '/apps/new?error=install-not-found');
  }
  log.info(`${result.user.login} signed in`);
  res.redirect('/');
}

// GET /api/auth/me
export async function me(req, res) {
  const user = req.user && (await currentUser(req.user.id));
  if (!user) {
    res.append('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAgeMs: 0, secure }));
    return res.status(401).json({ error: 'Sign in first' });
  }
  res.json(user);
}

// POST /api/auth/logout
export function logout(_req, res) {
  res.append('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAgeMs: 0, secure }));
  res.status(204).end();
}
