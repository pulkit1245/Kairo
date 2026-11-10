import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDatabaseDown, shortError } from '../../src/utils/AppError.js';

describe('shortError', () => {
  it('skips the blank line and the prisma call site', () => {
    const err = Object.assign(
      new Error("\nInvalid `prisma.incident.create()` invocation:\n\n\nCan't reach database server at `localhost:5432`\n\nPlease make sure..."),
      { code: 'P1001' },
    );
    assert.equal(shortError(err), "P1001: Can't reach database server at `localhost:5432`");
  });

  it('works for plain errors', () => {
    assert.equal(shortError(new Error('boom')), 'boom');
  });
});

describe('isDatabaseDown', () => {
  it('knows the connection error codes', () => {
    assert.equal(isDatabaseDown({ code: 'P1001' }), true);
    assert.equal(isDatabaseDown({ code: 'P2002' }), false);
    assert.equal(isDatabaseDown(new Error('x')), false);
  });
});
