import { env } from '../config/env.config.js';
import { prisma } from '../db/index.js';
import { shortError } from '../utils/AppError.js';
import { createLogger } from '../utils/logger.js';

// The Gemini client (FR-17 to FR-20, FR-28, FR-53). Plain REST through fetch,
// no SDK. Every call asks for JSON against a fixed schema and never throws:
// a failure returns null and the caller carries on with defaults or the
// rule-based cause (PRD section 8, FR-54).
//
// The key goes only in the x-goog-api-key header. It is never logged, and
// neither are prompts (they may hold repo code or app logs).
//
// Models: GEMINI_MODEL first, then GEMINI_FALLBACK_MODEL when the first one is
// busy (503, 429), failing (5xx) or slower than GEMINI_TIMEOUT_MS. A busy
// model is skipped for BUSY_SKIP_MS, so each call doesn't wait for it again.
// A model out of quota (429 with a retry delay, e.g. the free tier's 20
// requests a day) is skipped until Google says to come back.

const log = createLogger('gemini');
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
export const BUSY_SKIP_MS = 5 * 60 * 1000;
const MAX_SKIP_MS = 24 * 60 * 60 * 1000;

let fetchFn = (...a) => fetch(...a);
let db = prisma;
const busyUntil = new Map(); // model -> { until, quota } when it may be tried again
// what the header pill shows: the last call's outcome
const status = { state: null, model: null, at: null, detail: null };

export const geminiEnabled = () => env.gemini.enabled && Boolean(env.gemini.apiKey);

/**
 * GET /api/health's gemini field.
 * @returns {{ state: 'off'|'up'|'down'|'unknown', model: string|null, detail: string|null, at: string|null }}
 */
export function geminiStatus() {
  if (!env.gemini.enabled) return { state: 'off', model: null, detail: 'GEMINI_ENABLED=false', at: null };
  if (!env.gemini.apiKey) return { state: 'off', model: null, detail: 'no GEMINI_API_KEY', at: null };
  return {
    state: status.state ?? 'unknown',
    model: status.model ?? env.gemini.model,
    detail: status.detail,
    at: status.at?.toISOString() ?? null,
  };
}

/**
 * One question, one JSON answer.
 * @param {{ purpose: string, instructions: string, input: string, schema: object,
 *           cache?: { commitSha: string, question: string } }} q
 *   purpose: a few words for the log ("build explanation"). cache: look the
 *   answer up first and store a new one (FR-20)
 * @returns {Promise<{ data: object, model: string, cached: boolean } | null>}
 */
export async function askGemini({ purpose, instructions, input, schema, cache }) {
  if (!geminiEnabled()) return null;

  if (cache) {
    const hit = await db.geminiAnswer
      .findUnique({ where: { commitSha_question: cache }, select: { answer: true, model: true } })
      .catch((e) => log.warn(`cache read failed: ${shortError(e)}`));
    if (hit) {
      log.info(`${purpose}: cached answer for ${cache.commitSha.slice(0, 7)}`);
      return { data: hit.answer, model: hit.model, cached: true };
    }
  }

  const models = [env.gemini.model, env.gemini.fallbackModel].filter((m, i, all) => m && all.indexOf(m) === i);
  const now = Date.now();
  // a model marked busy is skipped. When all are, the last one that was only
  // busy (not out of quota) is tried anyway
  const order = models.filter((m) => !(busyUntil.get(m)?.until > now));
  if (!order.length) {
    const retry = models.findLast((m) => !busyUntil.get(m).quota);
    if (!retry) {
      log.warn(`${purpose}: skipped, ${models.join(' and ')} out of quota until ${quotaBack(models)}`);
      setStatus('down', env.gemini.model, `out of quota until ${quotaBack(models)}; Kairo uses its defaults`);
      return null;
    }
    order.push(retry);
  }

  for (const model of order) {
    const started = Date.now();
    const out = await generate(model, instructions, input, schema);
    const ms = Date.now() - started;
    if (out.ok) {
      busyUntil.delete(model);
      setStatus('up', model, model === env.gemini.model ? null : `${env.gemini.model} busy, answered by ${model}`);
      log.info(`${purpose}: answered by ${model} in ${ms} ms`);
      if (cache) {
        await db.geminiAnswer
          .upsert({
            where: { commitSha_question: cache },
            create: { ...cache, answer: out.data, model },
            update: { answer: out.data, model },
          })
          .catch((e) => log.warn(`cache write failed: ${shortError(e)}`));
      }
      return { data: out.data, model, cached: false };
    }
    log.warn(`${purpose}: ${model} ${out.why} after ${ms} ms`);
    if (out.busy) {
      const skip = Math.min(Math.max(BUSY_SKIP_MS, out.retryMs ?? 0), MAX_SKIP_MS);
      busyUntil.set(model, { until: Date.now() + skip, quota: skip > BUSY_SKIP_MS });
    }
    if (!out.tryNext) break;
  }
  setStatus('down', env.gemini.model, 'the last call failed; Kairo used its defaults');
  return null;
}

// the latest time a quota-skipped model comes back, as an ISO time
function quotaBack(models) {
  return new Date(Math.max(...models.map((m) => busyUntil.get(m)?.until ?? 0))).toISOString();
}

// one generateContent call. Never throws
async function generate(model, instructions, input, schema) {
  let res;
  try {
    res = await fetchFn(`${API}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.gemini.apiKey },
      signal: AbortSignal.timeout(env.gemini.timeoutMs),
      body: JSON.stringify(requestBody(instructions, input, schema)),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, busy: timedOut, tryNext: true, why: timedOut ? `timed out (${env.gemini.timeoutMs} ms)` : `unreachable (${shortError(err)})` };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    // an HTML error page or a cut-off body
  }
  if (!res.ok) {
    const busy = res.status === 429 || res.status === 503;
    // 4xx other than 429: the request itself is wrong; another model won't help
    // except 404 (model gone for this key)
    const tryNext = busy || res.status >= 500 || res.status === 404;
    // 429 says how long to wait: RetryInfo { retryDelay: "54399s" }
    const delay = body?.error?.details?.find((d) => d?.['@type']?.endsWith('RetryInfo'))?.retryDelay;
    const retryMs = /^\d+(\.\d+)?s$/.test(delay ?? '') ? Math.round(parseFloat(delay) * 1000) : null;
    const perDay = body?.error?.details?.some((d) => d?.violations?.some((v) => /PerDay/.test(v?.quotaId ?? '')));
    const why = `HTTP ${res.status} ${body?.error?.status ?? ''}${perDay ? ' (daily quota used up)' : ''}`.trim();
    return { ok: false, busy, tryNext, retryMs, why };
  }

  const candidate = body?.candidates?.[0];
  const text = candidate?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return { ok: true, data };
  } catch {
    // bad JSON is a failed answer (PRD section 8); another model may do better
    return { ok: false, busy: false, tryNext: true, why: `returned no usable JSON (finish ${candidate?.finishReason ?? 'none'})` };
  }
}

// exported for the tests: exactly what leaves the machine
export function requestBody(instructions, input, schema) {
  return {
    systemInstruction: { parts: [{ text: instructions }] },
    contents: [{ role: 'user', parts: [{ text: input }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      // short answers to concrete questions: little thinking keeps them fast
      thinkingConfig: { thinkingLevel: 'low' },
      maxOutputTokens: 2048,
    },
  };
}

function setStatus(state, model, detail) {
  Object.assign(status, { state, model, detail, at: new Date() });
}

/**
 * At boot: is the key good and the model there? A GET of the model costs no
 * tokens. Sets the pill; never throws.
 */
export async function checkGemini() {
  if (!geminiEnabled()) {
    log.info(`off (${geminiStatus().detail})`);
    return;
  }
  try {
    const res = await fetchFn(`${API}/${encodeURIComponent(env.gemini.model)}`, {
      headers: { 'x-goog-api-key': env.gemini.apiKey },
      signal: AbortSignal.timeout(env.gemini.timeoutMs),
    });
    if (res.ok) {
      setStatus('up', env.gemini.model, null);
      log.info(`on: ${env.gemini.model}${env.gemini.fallbackModel ? `, falling back to ${env.gemini.fallbackModel}` : ''}`);
    } else {
      setStatus('down', env.gemini.model, `the model check got HTTP ${res.status}`);
      log.warn(`${env.gemini.model} check got HTTP ${res.status}; Gemini calls will likely fail`);
    }
  } catch (err) {
    setStatus('down', env.gemini.model, 'Gemini unreachable');
    log.warn(`could not reach Gemini: ${shortError(err)}`);
  }
}

// test hooks
export function _setFetch(fn) {
  fetchFn = fn;
}
export function _setDb(fake) {
  db = fake;
}
export function _reset() {
  fetchFn = (...a) => fetch(...a);
  db = prisma;
  busyUntil.clear();
  Object.assign(status, { state: null, model: null, at: null, detail: null });
}
