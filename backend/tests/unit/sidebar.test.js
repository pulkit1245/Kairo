import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toAppSummaryDto } from '../../src/models/dto.mapper.js';
import { CLUSTER_QUERIES, CLUSTER_TIMEOUT_MS, clusterSnapshot } from '../../src/services/metrics.service.js';

// The sidebar's cluster card and Incidents badge (P4 UI notes, 12 Nov)

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// answers like Prometheus would; `delay` per query, `fail` the queries that error
function fakes({ delay = 0, fail = [], hang = [] } = {}) {
  const seen = [];
  const answer = async (expr, opts, value) => {
    seen.push({ expr, timeoutMs: opts.timeoutMs });
    if (hang.includes(expr)) {
      // what AbortSignal.timeout does to a query that doesn't answer in time
      await wait(opts.timeoutMs);
      throw new Error('The operation was aborted due to timeout');
    }
    await wait(delay);
    if (fail.includes(expr)) throw new Error('Prometheus 503: no answer');
    return value;
  };
  return {
    seen,
    deps: {
      timeoutMs: 40,
      queryNumber: (expr, opts) => answer(expr, opts, expr === CLUSTER_QUERIES.cpu ? 0.5 : 3_023_646_720),
      queryVector: (expr, opts) =>
        answer(expr, opts, [
          { labels: { resource: 'cpu' }, value: 4 },
          { labels: { resource: 'memory' }, value: 5_034_045_440 },
        ]),
    },
  };
}

describe('cluster card numbers', () => {
  it('reads CPU and memory use against what the node can give', async () => {
    const { deps, seen } = fakes();
    assert.deepEqual(await clusterSnapshot(deps), { cpuCores: 0.5, cpuTotal: 4, memoryBytes: 3_023_646_720, memoryTotalBytes: 5_034_045_440 });
    assert.equal(seen.length, 3);
    assert.ok(seen.every((q) => q.timeoutMs === 40), 'every query gets the short timeout');
  });

  it('runs the three queries at once', async () => {
    const { deps } = fakes({ delay: 60 });
    const started = Date.now();
    await clusterSnapshot(deps);
    assert.ok(Date.now() - started < 150, `took ${Date.now() - started} ms; one after another would be 180 ms or more`);
  });

  it('a failed or timed-out query gives null, the rest still show, nothing throws', async () => {
    const { deps } = fakes({ fail: [CLUSTER_QUERIES.memory], hang: [CLUSTER_QUERIES.allocatable] });
    const started = Date.now();
    assert.deepEqual(await clusterSnapshot(deps), { cpuCores: 0.5, cpuTotal: null, memoryBytes: null, memoryTotalBytes: null });
    assert.ok(Date.now() - started < 200, 'waits no longer than the timeout');
  });

  it('Prometheus down: all null', async () => {
    const { deps } = fakes({ fail: Object.values(CLUSTER_QUERIES) });
    assert.deepEqual(await clusterSnapshot(deps), { cpuCores: null, cpuTotal: null, memoryBytes: null, memoryTotalBytes: null });
  });

  it('the real timeout is short', () => {
    assert.ok(CLUSTER_TIMEOUT_MS <= 2000);
  });
});

describe('the Apps list summary', () => {
  it('carries the open-incident count for the sidebar', () => {
    const row = { id: 'a', slug: 'demo', repoFullName: 'o/demo', health: 'HEALTHY', autoHeal: true, replicas: 1, releases: [], pipelineRuns: [], incidents: [] };
    assert.equal(toAppSummaryDto({ ...row, _count: { incidents: 2 } }, {}).openIncidents, 2);
    assert.equal(toAppSummaryDto(row, {}).openIncidents, 0);
  });
});
