import { env } from '../config/env.config.js';

// The one place that queries Prometheus, through the local port-forward
// (FR-57). Like kubernetes/, a client both remediation/ (scale-down) and the
// app page's metrics may import. Every query is written in Kairo's code; none
// comes from a request (FR-57).

const TIMEOUT_MS = 5000;

async function call(path, params) {
  const res = await fetch(`${env.prometheusUrl}${path}?${new URLSearchParams(params)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
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
export async function queryNumber(expr) {
  const data = await call('/api/v1/query', { query: expr });
  if (data.resultType === 'scalar') return Number(data.result[1]);
  const first = data.result[0];
  return first ? Number(first.value[1]) : null;
}

/**
 * A range query for one series: [[unixSeconds, value], ...]. Empty when
 * Prometheus has nothing for the range.
 */
export async function querySeries(expr, { startSec, endSec, stepSec }) {
  const data = await call('/api/v1/query_range', { query: expr, start: startSec, end: endSec, step: stepSec });
  const first = data.result[0];
  return first ? first.values.map(([t, v]) => [Number(t), Number(v)]) : [];
}
