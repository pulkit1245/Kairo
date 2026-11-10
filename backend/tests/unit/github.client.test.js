import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { NO_TOKEN_CACHE } from '../../src/github/github.client.js';
import { onboardRepo } from '../../src/services/deployment.service.js';

// a throwaway key, made for this test only
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

// stands in for GitHub: counts how often an installation token is minted
function fakeGithub() {
  const calls = { mint: 0 };
  const fetch = async (url) => {
    if (/\/app\/installations\/\d+\/access_tokens$/.test(String(url))) {
      calls.mint++;
      const body = {
        token: `ghs_fake${calls.mint}`,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        permissions: { contents: 'write' },
        repository_selection: 'selected',
      };
      return new Response(JSON.stringify(body), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };
  return { calls, request: new Octokit({ request: { fetch } }).request };
}

describe('installation tokens (FR-5)', () => {
  it('are minted on every use with NO_TOKEN_CACHE', async () => {
    const gh = fakeGithub();
    const auth = createAppAuth({ appId: 1, privateKey, installationId: 42, cache: NO_TOKEN_CACHE, request: gh.request });
    const first = await auth({ type: 'installation' });
    const second = await auth({ type: 'installation' });
    assert.equal(gh.calls.mint, 2);
    assert.notEqual(first.token, second.token);
  });

  it('would be reused by the default auth-app cache (what NO_TOKEN_CACHE prevents)', async () => {
    const gh = fakeGithub();
    const auth = createAppAuth({ appId: 1, privateKey, installationId: 42, request: gh.request });
    await auth({ type: 'installation' });
    await auth({ type: 'installation' });
    assert.equal(gh.calls.mint, 1);
  });

  it('NO_TOKEN_CACHE never hands anything back', async () => {
    await NO_TOKEN_CACHE.set('k', 'ghs_secret');
    assert.equal(await NO_TOKEN_CACHE.get('k'), undefined);
  });
});

describe('onboardRepo input', () => {
  it('needs owner/repo before it asks GitHub anything', async () => {
    for (const bad of [undefined, '', 'just-a-name', 'a/b/c', 'own er/repo', '../x']) {
      await assert.rejects(() => onboardRepo('user1', bad), /owner\/repo/, String(bad));
    }
  });
});
