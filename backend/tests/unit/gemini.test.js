import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { env } from '../../src/config/env.config.js';
import { assertKnown, detectFacts } from '../../src/generator/detection/detection.service.js';
import { buildInput, candidates, fileTree, fillUnknownFacts, MAX_PATHS } from '../../src/generator/detection/fill.service.js';
import { explainBuildFailure, explainIncident } from '../../src/gemini/explain.service.js';
import { _reset, _setDb, _setFetch, askGemini, chain, geminiStatus, MAX_ATTEMPTS } from '../../src/gemini/gemini.client.js';
import { modelList } from '../../src/config/env.config.js';
import { isSecretFile, redact } from '../../src/gemini/redact.service.js';

// Gemini is never called for real here: fetch and the cache table are fakes,
// and the key is a test value, never the one in .env.

const saved = { ...env.gemini };
let dir;
beforeEach(async () => {
  Object.assign(env.gemini, { enabled: true, apiKey: 'test-key', model: 'main-model', fallbackModels: ['spare-model'], timeoutMs: 200 });
  _reset();
  _setDb(fakeDb());
  dir = await mkdtemp(path.join(os.tmpdir(), 'kairo-gemini-'));
});
afterEach(async () => {
  Object.assign(env.gemini, saved);
  _reset();
  await rm(dir, { recursive: true, force: true });
});

const put = async (file, content = '') => {
  await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
  await writeFile(path.join(dir, file), content);
};

function fakeDb() {
  const rows = new Map();
  const key = (w) => `${w.commitSha_question.commitSha}|${w.commitSha_question.question}`;
  return {
    rows,
    geminiAnswer: {
      findUnique: async ({ where }) => rows.get(key(where)) ?? null,
      upsert: async ({ where, create }) => rows.set(key(where), { answer: create.answer, model: create.model }),
    },
  };
}

const answer = (obj, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } : { error: { status: 'X' } }), {
    status,
  });

// records every request; replies from a list, one per call
function fakeFetch(replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const next = replies.shift();
    if (next === 'hang') {
      // AbortSignal.timeout's timer doesn't keep the process alive; this one does
      const alive = setTimeout(() => {}, 5000);
      return new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => {
          clearTimeout(alive);
          reject(init.signal.reason);
        }),
      );
    }
    return typeof next === 'function' ? next() : next;
  };
  fn.calls = calls;
  return fn;
}

const q = { purpose: 'test', instructions: 'i', input: 'x', schema: { type: 'object' } };

describe('Gemini client', () => {
  it('sends the key only in the header, and asks for JSON against the schema', async () => {
    const f = fakeFetch([answer({ ok: true })]);
    _setFetch(f);
    const out = await askGemini(q);
    assert.deepEqual(out, { data: { ok: true }, model: 'main-model', cached: false });
    const [call] = f.calls;
    assert.equal(call.init.headers['x-goog-api-key'], 'test-key');
    assert.ok(!call.url.includes('test-key'));
    assert.ok(!call.init.body.includes('test-key'));
    assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
    assert.match(call.url, /models\/main-model:generateContent$/);
    assert.equal(geminiStatus().state, 'up');
  });

  it('falls back when the model is busy, then skips the busy one for a while', async () => {
    const f = fakeFetch([answer(null, 503), answer({ n: 1 }), answer({ n: 2 })]);
    _setFetch(f);
    assert.equal((await askGemini(q)).model, 'spare-model');
    assert.equal((await askGemini(q)).model, 'spare-model');
    assert.deepEqual(
      f.calls.map((c) => c.url.match(/models\/([\w-]+):/)[1]),
      ['main-model', 'spare-model', 'spare-model'],
      'the busy model was not asked again',
    );
    assert.match(geminiStatus().detail, /busy, answered by spare-model/);
  });

  it('falls back on a timeout and on bad JSON; returns null when both fail', async () => {
    _setFetch(fakeFetch(['hang', () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }))]));
    assert.equal(await askGemini(q), null);
    assert.equal(geminiStatus().state, 'down');
  });

  it('skips a model out of daily quota until Google says, and stops calling when all are', async () => {
    const quota = () =>
      new Response(
        JSON.stringify({
          error: {
            status: 'RESOURCE_EXHAUSTED',
            details: [
              { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
              { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '54399s' },
            ],
          },
        }),
        { status: 429 },
      );
    const f = fakeFetch([quota, quota]);
    _setFetch(f);
    assert.equal(await askGemini(q), null);
    assert.equal(f.calls.length, 2);
    // both out of quota for 15 hours: no call at all
    assert.equal(await askGemini(q), null);
    assert.equal(f.calls.length, 2);
    assert.match(geminiStatus().detail, /out of quota until/);
  });

  it('walks the fallback list, one attempt per model, and stops at the first answer', async () => {
    env.gemini.fallbackModels = ['m2', 'm3', 'm4'];
    const f = fakeFetch([answer({}, 503), answer({}, 500), answer({ ok: 3 })]);
    _setFetch(f);
    const out = await askGemini(q);
    assert.deepEqual(out, { data: { ok: 3 }, model: 'm3', cached: false });
    assert.deepEqual(f.calls.map((c) => c.url.match(/models\/([^:]+)/)[1]), ['main-model', 'm2', 'm3']);
  });

  it('makes at most 4 attempts, never two on the same model', async () => {
    env.gemini.fallbackModels = ['m2', 'main-model', 'm3', 'm2', 'm4', 'm5', 'm6'];
    assert.deepEqual(chain(), ['main-model', 'm2', 'm3', 'm4']);
    assert.equal(MAX_ATTEMPTS, 4);
    const f = fakeFetch(Array.from({ length: 10 }, () => answer({}, 503)));
    _setFetch(f);
    assert.equal(await askGemini(q), null);
    const tried = f.calls.map((c) => c.url.match(/models\/([^:]+)/)[1]);
    assert.deepEqual(tried, ['main-model', 'm2', 'm3', 'm4']);
  });

  it('gives each attempt its own timeout, so a slow model costs one timeout, not the chain', async () => {
    env.gemini.fallbackModels = ['m2', 'm3', 'm4'];
    const f = fakeFetch(['hang', 'hang', answer({ ok: true })]);
    _setFetch(f);
    const started = Date.now();
    const out = await askGemini(q);
    const took = Date.now() - started;
    assert.equal(out.model, 'm3');
    // two timeouts of 200 ms, then an answer: about 400 ms, not more
    assert.ok(took >= 380 && took < 1200, `took ${took} ms`);
    for (const c of f.calls) assert.ok(c.init.signal instanceof AbortSignal, 'every attempt has its own signal');
    assert.notEqual(f.calls[0].init.signal, f.calls[1].init.signal);
  });

  it('reads the fallback list from a comma-separated setting', () => {
    assert.deepEqual(modelList(' a, b ,,c ', ['x']), ['a', 'b', 'c']);
    assert.deepEqual(modelList(undefined, ['x']), ['x']);
    assert.deepEqual(modelList('', ['x']), []);
  });

  it("doesn't try another model when the request itself is wrong (400)", async () => {
    const f = fakeFetch([answer(null, 400)]);
    _setFetch(f);
    assert.equal(await askGemini(q), null);
    assert.equal(f.calls.length, 1);
  });

  it('is off without the switch or the key, and never calls out', async () => {
    const f = fakeFetch([]);
    _setFetch(f);
    env.gemini.enabled = false;
    assert.equal(await askGemini(q), null);
    assert.equal(geminiStatus().state, 'off');
    env.gemini.enabled = true;
    env.gemini.apiKey = null;
    assert.equal(await askGemini(q), null);
    assert.equal(f.calls.length, 0);
  });

  it('caches per commit sha and question (FR-20)', async () => {
    const f = fakeFetch([answer({ v: 1 })]);
    _setFetch(f);
    const cache = { commitSha: 'a'.repeat(40), question: 'facts:v1:X' };
    assert.equal((await askGemini({ ...q, cache })).cached, false);
    const again = await askGemini({ ...q, cache });
    assert.deepEqual(again, { data: { v: 1 }, model: 'main-model', cached: true });
    assert.equal(f.calls.length, 1);
  });
});

describe('redaction (FR-18, FR-53)', () => {
  const secrets = [
    'ghp_' + 'a1B2'.repeat(9),
    'github_pat_' + 'x9'.repeat(15),
    'AIza' + 'Sy'.repeat(17) + 'abc',
    'AKIA' + 'ABCDEFGHIJKLMNOP',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'hunter2-super-secret',
  ];
  const text = [
    `token=${secrets[0]}`,
    `export GH=${secrets[1]}`,
    `"apiKey": "${secrets[2]}"`,
    `aws ${secrets[3]}`,
    `Authorization: Bearer ${secrets[4]}`,
    `DB_PASSWORD=${secrets[5]}`,
    'postgres://kairo:hunter3@db:5432/app',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
  ].join('\n');

  it('removes tokens, keys and passwords, keeping the rest', () => {
    const out = redact(text);
    for (const s of [...secrets, 'hunter3', 'MIIEow']) assert.ok(!out.includes(s), `leaked ${s.slice(0, 8)}…`);
    assert.match(out, /postgres:\/\/kairo:\[redacted\]@db:5432\/app/);
    assert.equal(redact('GET / 200 12ms'), 'GET / 200 12ms');
  });

  it('knows which files never leave', () => {
    for (const f of ['.env', '.env.local', 'config/.env.production', 'deploy/key.pem', 'id_rsa', '.npmrc']) assert.ok(isSecretFile(f), f);
    for (const f of ['src/index.js', 'environment.js', 'README.md']) assert.ok(!isSecretFile(f), f);
  });

  it("an outgoing request never carries the repo's secrets (PRD section 9 metric)", async () => {
    await put('package.json', JSON.stringify({ name: 'demo', main: 'index.js', config: { token: secrets[0] } }));
    await put('.env', `SECRET=${secrets[5]}`);
    await put('server.key', 'KEYDATA');
    await put('src/index.js', `const key = "${secrets[2]}";\nrequire('http').createServer().listen(process.env.PORT);\n`);
    const detected = await detectFacts(dir);
    const f = fakeFetch([answer({ startFile: 'src/index.js', appVariable: '', reason: 'r' }), answer({ explanation: 'e' }), answer({ explanation: 'e' })]);
    _setFetch(f);
    await fillUnknownFacts(dir, detected, { commitSha: 'b'.repeat(40) });
    await explainBuildFailure({ commitSha: 'b'.repeat(40), stack: 'NODE', reason: 'failed', logTail: [`npm ERR! ${secrets[1]}`] });
    await explainIncident({ alertName: 'KairoAppDown', cause: 'c', logs: `Bearer ${secrets[4]}\npassword=${secrets[5]}` });
    const sent = f.calls.map((c) => c.init.body).join('\n');
    assert.equal(f.calls.length, 3);
    for (const s of [...secrets, 'KEYDATA', 'server.key']) assert.ok(!sent.includes(s), `sent ${s.slice(0, 8)}…`);
    // not even the .env file's name is in the tree (process.env in the code is fine)
    const factInput = f.calls[0].body.contents[0].parts[0].text;
    assert.doesNotMatch(factInput, /^\.env$/m);
    assert.match(factInput, /^src\/index\.js$/m);
  });
});

describe('fact-filling (FR-17 to FR-20)', () => {
  // docker/getting-started-app: main names index.js, the file is src/index.js
  const gettingStarted = async () => {
    await put('package.json', JSON.stringify({ name: 'getting-started', main: 'index.js', scripts: { dev: 'nodemon src/index.js' } }));
    await put('src/index.js', "const express = require('express');\nconst app = express();\napp.listen(3000);\n");
    await put('src/routes/getItems.js', 'module.exports = () => {};\n');
    await put('src/static/js/app.js', '');
    await put('spec/routes/getItems.spec.js', '');
  };

  it('leaves the start unknown for Gemini instead of failing (docker/getting-started-app)', async () => {
    await gettingStarted();
    const d = await detectFacts(dir);
    assert.equal(d.startCommand, null);
    assert.equal(d.unknown[0].ask, 'NODE_START_FILE');
    assert.throws(() => assertKnown(d), /"main" field \(index\.js\) that isn't in the repo/);
  });

  it('fills it from one call, with source gemini, and the PR input shows the candidates', async () => {
    await gettingStarted();
    const d = await detectFacts(dir);
    let sent;
    const ask = async (req) => {
      sent = req;
      return { data: { startFile: './src/index.js', appVariable: '', reason: 'It creates the Express app and listens.' }, model: 'm', cached: false };
    };
    const r = await fillUnknownFacts(dir, d, { commitSha: 'c'.repeat(40) }, ask);
    assert.deepEqual(r, { asked: true, filled: ['startCommand'], dropped: null });
    assert.deepEqual(d.startCommand, ['node', 'src/index.js']);
    assert.deepEqual(d.facts.startCommand, { value: 'node src/index.js', source: 'gemini', from: 'It creates the Express app and listens.' });
    assert.deepEqual(d.unknown, []);
    assert.deepEqual(sent.cache, { commitSha: 'c'.repeat(40), question: 'facts:v1:NODE_START_FILE' });
    assert.match(sent.input, /--- src\/index\.js \(first 60 lines\) ---/);
    assert.doesNotMatch(sent.input, /spec\/routes\/getItems\.spec\.js \(first/);
  });

  it('drops an answer that fails validation, and the rule reason stands (FR-19)', async () => {
    await gettingStarted();
    for (const startFile of ['index.js', '../../etc/passwd', 'src/routes', 'src/static/css/x.css']) {
      const d = await detectFacts(dir);
      const r = await fillUnknownFacts(dir, d, { commitSha: 'c'.repeat(40) }, async () => ({ data: { startFile, appVariable: '', reason: 'r' } }));
      assert.ok(r.dropped, startFile);
      assert.throws(() => assertKnown(d), /no "start" script/);
    }
  });

  it("checks a Python app's variable is really in the file", async () => {
    await put('requirements.txt', 'flask\n');
    await put('src/service/web.py', 'import flask\nserver = flask.Flask(__name__)\n');
    await put('src/service/__init__.py', '');
    let d = await detectFacts(dir);
    assert.equal(d.unknown[0].ask, 'PYTHON_APP');
    const r1 = await fillUnknownFacts(dir, d, { commitSha: 'd'.repeat(40) }, async () => ({ data: { startFile: 'src/service/web.py', appVariable: 'app', reason: 'r' } }));
    assert.match(r1.dropped, /no top-level app = /);

    d = await detectFacts(dir);
    await fillUnknownFacts(dir, d, { commitSha: 'd'.repeat(40) }, async () => ({ data: { startFile: 'src/service/web.py', appVariable: 'server', reason: 'r' } }));
    // src has no __init__.py: gunicorn runs from src, the package is service
    assert.deepEqual(d.startCommand, ['gunicorn', '--bind', '0.0.0.0:8000', '--access-logfile', '-', '--chdir', 'src', 'service.web:server']);
    assert.equal(d.facts.appEntry.source, 'gemini');
    assert.equal(d.python.serverPackage, 'gunicorn');
  });

  it('with Gemini off, nothing is asked and the rules decide (FR-20)', async () => {
    await gettingStarted();
    env.gemini.enabled = false;
    const d = await detectFacts(dir);
    let asked = false;
    const r = await fillUnknownFacts(dir, d, { commitSha: 'e'.repeat(40) }, async () => {
      asked = true;
    });
    assert.equal(asked, false);
    assert.equal(r.asked, false);
    assert.throws(() => assertKnown(d));
  });

  it('sends at most 300 paths and 3 candidate files (FR-18)', async () => {
    await put('package.json', '{}');
    for (let i = 0; i < 320; i++) await put(`lib/f${String(i).padStart(3, '0')}.js`, '');
    await put('node_modules/x/index.js', '');
    const tree = await fileTree(dir);
    assert.equal(tree.length, MAX_PATHS);
    assert.ok(tree.truncated);
    assert.ok(!tree.some((p) => p.startsWith('node_modules')));
    assert.equal(tree[0], 'package.json', 'shallow files first');
    assert.equal(candidates(tree, 'NODE').length, 3);
    const input = await buildInput(dir, { stack: 'NODE', python: null }, { ask: 'NODE_START_FILE', hint: 'h' });
    assert.match(input, /File tree \(300, first 300 paths\)/);
  });
});

describe('explanations (FR-28, FR-53)', () => {
  it('a failed build is explained from its last 80 lines, cached by log', async () => {
    let sent;
    const ask = async (req) => {
      sent = req;
      return { data: { explanation: '  The build ran   npm ci without a lockfile.  ' } };
    };
    const logTail = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const text = await explainBuildFailure({ commitSha: 'f'.repeat(40), stack: 'NODE', reason: 'exit 1', logTail }, ask);
    assert.equal(text, 'The build ran npm ci without a lockfile.');
    assert.ok(sent.input.includes('line 99') && sent.input.includes('line 20') && !sent.input.includes('line 19\n'));
    assert.match(sent.cache.question, /^build:v1:[0-9a-f]{16}$/);
  });

  it('an incident is explained from the alert and the last 50 log lines', async () => {
    let sent;
    const ask = async (req) => {
      sent = req;
      return { data: { explanation: 'The /leak route keeps every request in memory.' } };
    };
    const logs = Array.from({ length: 70 }, (_, i) => `log ${i}`).join('\n');
    const text = await explainIncident({ alertName: 'KairoOOMKilled', cause: 'ran out of memory', logs, previous: true, pod: 'p-1' }, ask);
    assert.equal(text, 'The /leak route keeps every request in memory.');
    assert.match(sent.input, /Alert: KairoOOMKilled/);
    assert.match(sent.input, /p-1 \(from the run that ended\)/);
    assert.ok(sent.input.includes('log 69') && !sent.input.includes('log 19\n'));
    assert.equal(sent.cache, undefined);
  });

  it('gives null when Gemini has nothing to say', async () => {
    assert.equal(await explainBuildFailure({ commitSha: 'a'.repeat(40), stack: 'NODE', reason: 'r', logTail: ['x'] }, async () => null), null);
    assert.equal(await explainIncident({ alertName: 'A', cause: 'c', logs: null }, async () => ({ data: { explanation: ' ' } })), null);
  });
});
