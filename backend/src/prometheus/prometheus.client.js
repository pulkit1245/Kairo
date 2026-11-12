import { env } from '../config/env.config.js';

// The one place that queries Prometheus, through the local port-forward
// (FR-57). Like kubernetes/, a client both remediation/ (scale-down) and the
// app page's metrics may import. Every query is written in Kairo's code; none
// comes from a request (FR-57).

const TIMEOUT_MS = 5000;

async function call(path, params, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(`${env.prometheusUrl}${path}?${new URLSearchParams(params)}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status !== 'success') {
    throw new Error(`Prometheus ${res.status}: ${body?.error ?? 'no answer'}`);
  }
  return body.data;
}

/**
 * An instant query that returns one number (a scalar, or the first sample of
 * a vector). null when the vector is empty, e.g. no traffic yet.
 */
export async function queryNumber(expr, { timeoutMs } = {}) {
  const data = await call('/api/v1/query', { query: expr }, timeoutMs);
  if (data.resultType === 'scalar') return sample(data.result[1]);
  const first = data.result[0];
  return first ? sample(first.value[1]) : null;
}

/**
 * An instant query that returns several series: [{ labels, value }].
 */
export async function queryVector(expr, { timeoutMs } = {}) {
  const data = await call('/api/v1/query', { query: expr }, timeoutMs);
  return data.result.map((r) => ({ labels: r.metric, value: sample(r.value[1]) }));
}

// a sample value; NaN (e.g. 0 errors / 0 requests) and Inf become null
const sample = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A range query for one series: [[unixSeconds, value], ...]. Empty when
 * Prometheus has nothing for the range.
 */
export async function querySeries(expr, range) {
  const [first] = await queryRange(expr, range);
  return first ? first.points : [];
}

/**
 * A range query for every series it returns: [{ labels, points }], where
 * points are [[unixSeconds, value|null], ...].
 */
export async function queryRange(expr, { startSec, endSec, stepSec }) {
  const data = await call('/api/v1/query_range', { query: expr, start: startSec, end: endSec, step: stepSec });
  return data.result.map((r) => ({ labels: r.metric, points: r.values.map(([t, v]) => [Number(t), sample(v)]) }));
}
