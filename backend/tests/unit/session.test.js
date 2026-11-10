import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cookie,
  isAllowed,
  parseCookies,
  sameState,
  SESSION_TTL_MS,
  signSession,
  verifySession,
} from '../../src/utils/session.js';

const SECRET = 'test-session-secret-0123456789abcdef';
const payload = { uid: 'user1', login: 'PunitXd' };

describe('session cookie (FR-1)', () => {
  it('round-trips a signed session', () => {
    const v = verifySession(signSession(payload, SECRET), SECRET);
    assert.equal(v.uid, 'user1');
    assert.equal(v.login, 'PunitXd');
  });

  it('rejects an edited payload, another secret, garbage and nothing', () => {
    const value = signSession(payload, SECRET);
    const [, sig] = value.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...payload, login: 'someone-else', exp: Date.now() + 1e6 })).toString('base64url')}.${sig}`;
    assert.equal(verifySession(forged, SECRET), null);
    assert.equal(verifySession(value, 'another-secret-0123456789abcdef00'), null);
    assert.equal(verifySession('not-a-cookie', SECRET), null);
    assert.equal(verifySession(undefined, SECRET), null);
    assert.equal(verifySession(value, null), null);
  });

  it('expires after 12 hours', () => {
    const now = Date.now();
    const value = signSession(payload, SECRET, now);
    assert.ok(verifySession(value, SECRET, now + SESSION_TTL_MS - 1000));
    assert.equal(verifySession(value, SECRET, now + SESSION_TTL_MS), null);
  });
});

describe('allow-list (FR-2)', () => {
  const allowed = new Set(['punitxd', 'pulkit1245']);
  it('matches logins without caring about case', () => {
    assert.equal(isAllowed('PunitXd', allowed), true);
    assert.equal(isAllowed('sam-k', allowed), false);
    assert.equal(isAllowed('', allowed), false);
    assert.equal(isAllowed(undefined, allowed), false);
  });
});

describe('cookies and state', () => {
  it('parses a cookie header and ignores junk', () => {
    assert.deepEqual(parseCookies('a=1; kairo_session=x.y; broken; b=%E0%A4%A'), { a: '1', kairo_session: 'x.y' });
    assert.deepEqual(parseCookies(undefined), {});
  });

  it('writes httpOnly, SameSite=Lax cookies', () => {
    const c = cookie('kairo_session', 'v', { maxAgeMs: 60_000 });
    assert.match(c, /^kairo_session=v; Path=\/; HttpOnly; SameSite=Lax; Max-Age=60$/);
    assert.match(cookie('x', 'v', { secure: true }), /; Secure$/);
  });

  it('compares state values exactly', () => {
    assert.equal(sameState('abc', 'abc'), true);
    assert.equal(sameState('abc', 'abd'), false);
    assert.equal(sameState('abc', undefined), false);
    assert.equal(sameState(undefined, undefined), false);
  });
});
