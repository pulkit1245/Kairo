import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requireAlertToken } from '../../src/middlewares/alertAuth.middleware.js';

// just enough of express' req/res for the middleware
function call(mw, authorization) {
  const req = { method: 'POST', originalUrl: '/api/alerts', get: () => authorization };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let passed = false;
  mw(req, res, () => { passed = true; });
  return { passed, status: res.statusCode };
}

describe('requireAlertToken (FR-45)', () => {
  const mw = requireAlertToken('s3cret-token-of-enough-length-000000');

  it('lets the right bearer token through', () => {
    assert.equal(call(mw, 'Bearer s3cret-token-of-enough-length-000000').passed, true);
  });

  it('gives 401 without a header, with a wrong token, or with another scheme', () => {
    for (const h of [undefined, 'Bearer nope', 'Basic s3cret-token-of-enough-length-000000', 's3cret-token-of-enough-length-000000']) {
      const r = call(mw, h);
      assert.equal(r.passed, false, String(h));
      assert.equal(r.status, 401, String(h));
    }
  });

  it('refuses everything when no token is configured', () => {
    const open = requireAlertToken(null);
    assert.equal(call(open, 'Bearer anything').status, 401);
    assert.equal(call(open, 'Bearer ').status, 401);
  });
});
