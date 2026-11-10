import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// The session cookie (FR-1): no session table, the cookie carries who you are,
// signed so it can't be edited. value = base64url(JSON payload) "." base64url(HMAC-SHA256)

export const SESSION_COOKIE = 'kairo_session';
export const STATE_COOKIE = 'kairo_oauth_state';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const sign = (data, secret) => createHmac('sha256', secret).update(data).digest('base64url');

// payload: { uid, login }. Adds the expiry
export function signSession(payload, secret, now = Date.now()) {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: now + SESSION_TTL_MS })).toString('base64url');
  return `${data}.${sign(data, secret)}`;
}

// the payload, or null if the cookie is missing, edited, signed with another secret or expired
export function verifySession(value, secret, now = Date.now()) {
  if (!value || !secret) return null;
  const dot = value.indexOf('.');
  if (dot < 1) return null;
  const data = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(data, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload?.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.uid !== 'string' || typeof payload.login !== 'string') return null;
  return payload;
}

// the random value that ties GitHub's callback to the browser that started sign-in
export const newState = () => randomBytes(16).toString('hex');

export function sameState(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// FR-2. Checked at sign-in and again on every request, so removing a login
// from ALLOWED_GITHUB_LOGINS takes effect at once
export const isAllowed = (login, allowed) => Boolean(login) && allowed.has(String(login).toLowerCase());

export function parseCookies(header) {
  const out = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // a malformed cookie from something else on localhost: ignore it
    }
  }
  return out;
}

// httpOnly: the browser's JavaScript never sees it. SameSite=Lax: other sites
// can't send it along with a POST. Secure only when Kairo is served over https
export function cookie(name, value, { maxAgeMs, path = '/', secure = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
