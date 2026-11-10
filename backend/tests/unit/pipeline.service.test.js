import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { failInterruptedRuns } from '../../src/generator/pipeline.service.js';

// a stand-in for prisma that keeps runs in an array
function fakeDb(runs) {
  return {
    pipelineRun: {
      async findMany({ where }) {
        return runs.filter((r) => r.finishedAt === where.finishedAt);
      },
      async update({ where, data }) {
        Object.assign(runs.find((r) => r.id === where.id), data);
      },
    },
  };
}

describe('failInterruptedRuns', () => {
  it('fails only runs with no finishedAt, and keeps the step they were on', async () => {
    const done = new Date('2026-11-10T10:00:00Z');
    const runs = [
      { id: 'finished-at-generating', status: 'GENERATING', finishedAt: done },
      { id: 'already-failed', status: 'FAILED', finishedAt: done },
      { id: 'cut-off-while-cloning', status: 'CLONING', finishedAt: null },
    ];

    const count = await failInterruptedRuns(fakeDb(runs));

    assert.equal(count, 1);
    assert.equal(runs[0].status, 'GENERATING');
    assert.equal(runs[1].status, 'FAILED');
    assert.equal(runs[2].status, 'FAILED');
    assert.equal(runs[2].failedStep, 'CLONING');
    assert.match(runs[2].errorLog, /Interrupted/);
    assert.ok(runs[2].finishedAt instanceof Date);
  });
});
