import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// PRD section 9: "Secrets leaked: zero tokens or keys in logs, the browser or
// Gemini requests", as an automated test. Fake secrets are planted before
// anything loads (Node's .env loader never overwrites a variable that is
// already set, so no real value is read), the backend is driven, and
// everything that leaves it is searched for them: every log line, every HTTP
// response body and header, every Gemini request, and the browser bundle.

const S = {
  clientSecret: 'kairo-test-client-secret-9f3c1a2b',
  session: 'kairo-test-session-secret-77aa0c1d',
  gemini: 'AIzaSyKairoTestKeyDoNotUse00000000000000',
  alert: 'kairo-test-alert-token-5521abcd',
  install: 'ghs_KairoTestInstallationToken000000000',
  user: 'ghu_KairoTestUserToken0000000000000000000',
  dbPassword: 'kairo-test-db-password-31337',
  keyBody: 'KAIROTESTPRIVATEKEYBODY',
};
const MARKERS = Object.values(S);
const PEM = `-----BEGIN RSA PRIVATE KEY-----\n${S.keyBody}\n-----END RSA PRIVATE KEY-----`;

Object.assign(process.env, {
  GITHUB_CLIENT_SECRET: S.clientSecret,
  SESSION_SECRET: S.session,
  GEMINI_API_KEY: S.gemini,
  ALERT_WEBHOOK_TOKEN: S.alert,
  DATABASE_URL: `postgresql://kairo:${S.dbPassword}@127.0.0.1:1/kairo`,
  GITHUB_APP_ID: '1',
  GITHUB_APP_SLUG: 'kairo-test',
  GITHUB_CLIENT_ID: 'Iv1.kairotestclient',
  ALLOWED_GITHUB_LOGINS: 'tester',
  GEMINI_ENABLED: 'true',
  LOG_LEVEL: 'debug',
});

// everything written to the console, as text
const out = [];
const consoleSaved = {};
const leaks = (text) => MARKERS.filter((m) => String(text).includes(m));

let createLogger, prisma, createApp, signSession, askGemini, geminiReset, setFetch;
let server, base;

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info', 'debug']) {
    consoleSaved[k] = console[k];
    console[k] = (...args) => out.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }
  ({ createLogger } = await import('../../src/utils/logger.js'));
  ({ prisma } = await import('../../src/db/index.js'));
  ({ createApp } = await import('../../src/app.js'));
  ({ signSession } = await import('../../src/utils/session.js'));
  ({ askGemini, _reset: geminiReset, _setFetch: setFetch } = await import('../../src/gemini/gemini.client.js'));

  // the database is never reached: the few calls these routes make are fakes
  prisma.user.findUnique = async () => ({ id: 'u1', login: 'tester', avatarUrl: null, installations: [] });
  prisma.$queryRaw = async () => [{ ok: 1 }];

  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  Object.assign(console, consoleSaved);
});

describe('no secret in logs', () => {
  it('masks tokens, keys and Kairo\'s own secret values in lines and in logged errors', () => {
    const log = createLogger('test');
    const octokitLike = Object.assign(new Error('Bad credentials'), {
      status: 401,
      request: { method: 'GET', url: `https://api.github.com/x?access_token=${S.user}`, headers: { authorization: `token ${S.install}` } },
    });
    log.error('GitHub call failed', octokitLike);
    log.warn(`clone of https://x-access-token:${S.install}@github.com/a/b failed`);
    log.info(`settings: client secret ${S.clientSecret}, session ${S.session}, alert ${S.alert}`);
    log.error('database', new Error(`can't connect to postgresql://kairo:${S.dbPassword}@db:5432/kairo`));
    log.error('gemini', { headers: { 'x-goog-api-key': S.gemini }, url: `https://x/?key=${S.gemini}` });
    log.error('private key', new Error(PEM));
    log.debug('a user token', S.user);

    const text = out.join('\n');
    assert.deepEqual(leaks(text), [], `leaked into the log:\n${text}`);
    assert.ok((text.match(/\[redacted\]/g) ?? []).length >= 8, 'the lines were written, with the secrets masked');
  });
});

describe('no secret in what the browser gets', () => {
  const cookie = () => `kairo_session=${signSession({ uid: 'u1', login: 'tester' }, S.session)}`;
  const seen = [];
  async function hit(p, init = {}) {
    const res = await fetch(`${base}${p}`, { redirect: 'manual', ...init });
    const body = await res.text();
    seen.push({ p, status: res.status, text: `${body}\n${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}` });
    return res;
  }

  it('sign-in, session, health, errors and the alert webhook answer without one', async () => {
    assert.equal((await hit('/api/auth/login')).status, 302);
    assert.equal((await hit('/api/auth/me')).status, 401);
    assert.equal((await hit('/api/auth/me', { headers: { cookie: cookie() } })).status, 200);
    assert.equal((await hit('/api/health', { headers: { cookie: cookie() } })).status, 200);
    assert.equal((await hit('/api/auth/callback?code=abc&state=forged')).status, 302);
    assert.equal((await hit('/api/nowhere', { headers: { cookie: cookie() } })).status, 404);
    assert.equal((await hit('/api/apps', { method: 'POST', headers: { cookie: cookie(), 'content-type': 'application/json' }, body: '{bad json' })).status, 400);
    assert.equal((await hit('/api/alerts', { method: 'POST', headers: { authorization: `Bearer ${S.user}` } })).status, 401);

    for (const s of seen) assert.deepEqual(leaks(s.text), [], `${s.p} (${s.status}) leaked:\n${s.text}`);
    // and nothing those requests logged either
    assert.deepEqual(leaks(out.join('\n')), []);
  });
});

describe('no secret in a Gemini request, except the key in its own header', () => {
  it('the key travels only in x-goog-api-key, never in the URL, the body or a log line', async () => {
    geminiReset();
    const calls = [];
    setFetch(async (url, init) => {
      calls.push({ url, init });
      // a failing answer that even echoes the key back: it must not reach the log
      return new Response(JSON.stringify({ error: { status: 'INTERNAL', message: `bad key ${S.gemini}` } }), { status: 500 });
    });
    const answer = await askGemini({
      purpose: 'secrets test',
      instructions: 'explain',
      input: `build failed; token ${S.install}; ${PEM}; postgres://u:${S.dbPassword}@h/db`.replace(S.install, '[sent redacted by the caller]'),
      schema: { type: 'object' },
    });
    assert.equal(answer, null);
    assert.ok(calls.length >= 1);
    for (const c of calls) {
      assert.equal(c.init.headers['x-goog-api-key'], S.gemini);
      assert.ok(!String(c.url).includes(S.gemini), 'not in the URL');
      assert.ok(!String(c.init.body).includes(S.gemini), 'not in the body');
    }
    assert.deepEqual(leaks(out.join('\n')), [], 'not in any log line');
  });
});

describe('no secret in the browser bundle', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const frontend = path.resolve(here, '../../../frontend');
  const SHAPES = [/\bAIza[0-9A-Za-z_-]{30,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /PRIVATE KEY-----/, /\bsk-[A-Za-z0-9_-]{20,}/];

  async function files(dir) {
    const list = [];
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) list.push(...(await files(p)));
      else list.push(p);
    }
    return list;
  }

  it('the frontend reads no environment variables, so nothing secret can be built in', async () => {
    for (const f of (await files(path.join(frontend, 'src'))).filter((p) => /\.(jsx?|mjs)$/.test(p))) {
      const text = await readFile(f, 'utf8');
      assert.ok(!/import\.meta\.env|process\.env/.test(text), `${path.relative(frontend, f)} reads the environment`);
    }
    const vite = await readFile(path.join(frontend, 'vite.config.js'), 'utf8');
    assert.ok(!/\bdefine\s*:|envPrefix/.test(vite), 'vite.config.js builds values into the bundle');
  });

  it('a built bundle, if there is one, has nothing shaped like a token or key', async () => {
    const dist = path.join(frontend, 'dist');
    if (!(await stat(dist).catch(() => null))) return;
    for (const f of await files(dist)) {
      const text = await readFile(f, 'utf8').catch(() => '');
      for (const shape of SHAPES) assert.ok(!shape.test(text), `${path.relative(frontend, f)} has something shaped like ${shape}`);
    }
  });
});
