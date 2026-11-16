import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { prisma } from '../../src/db/index.js';
import { offersRollback, toAppDto, toReleaseDto } from '../../src/models/dto.mapper.js';
import { getAppIncidents, INCIDENT_PAGE, neighbourQueries } from '../../src/services/app.service.js';

// The app's screens (P5d, mockup v2): the header and banner facts, the
// Releases and Incidents screens' own endpoints, and Newer/Older

const at = (min) => new Date(Date.UTC(2026, 10, 16, 10, min));
const release = (id, fields = {}) => ({
  id,
  commitSha: id.repeat(40).slice(0, 40),
  commitMessage: `release ${id}`,
  imageRef: `img:${id}`,
  source: 'GHCR',
  status: 'SUPERSEDED',
  deployedAt: at(0),
  healthyAt: at(1),
  ...fields,
});
const appRow = (releases) => ({
  id: 'a1',
  slug: 'demo',
  repoFullName: 'someone/demo',
  defaultBranch: 'main',
  installationId: 'inst',
  stack: 'NODE',
  health: 'NEEDS_ATTENTION',
  autoHeal: true,
  replicas: 1,
  publicUrl: null,
  prState: 'MERGED',
  prNumber: 1,
  releases,
  pipelineRuns: [],
});

// Prisma's model methods sit behind a proxy that node:test's mock.method can't
// see, so they are swapped by hand and put back after each test
const restores = [];
function stub(delegate, name, fn) {
  const original = delegate[name];
  delegate[name] = fn;
  restores.push(() => (delegate[name] = original));
}
afterEach(() => restores.splice(0).forEach((r) => r()));

describe('the header and banner facts (GET /api/apps/:slug)', () => {
  const active = release('b', { status: 'ACTIVE', deployedAt: at(5) });

  it('offers "Roll back manually" only with an earlier healthy release whose image is stored', () => {
    const stored = new Set(['img:a', 'img:b']);
    const dto = (releases, s = stored) => toAppDto(appRow(releases), { graceMs: 60_000, storedImages: s });
    assert.equal(dto([active, release('a')]).canRollBack, true);
    assert.equal(dto([active, release('a', { healthyAt: null })]).canRollBack, false, 'never healthy');
    assert.equal(dto([active, release('a')], new Set(['img:b'])).canRollBack, false, 'image pruned');
    assert.equal(dto([active, release('a', { source: 'TEST' })]).canRollBack, false, "Break It's release");
    assert.equal(dto([active, release('a', { imageRef: 'img:b' })]).canRollBack, false, 'the image already running');
  });

  it('the same rule as the release list button', () => {
    const stored = new Set(['img:a']);
    assert.equal(offersRollback(release('a'), active, stored), true);
    assert.equal(offersRollback(active, active, stored), false);
  });

  it('carries the incident counts and the issue link', () => {
    const dto = toAppDto(appRow([active]), {
      graceMs: 60_000,
      storedImages: new Set(),
      counts: { open: 1, total: 7 },
      issue: { githubIssueNumber: 2 },
    });
    assert.equal(dto.openIncidents, 1);
    assert.equal(dto.incidentCount, 7);
    assert.deepEqual(dto.issue, { number: 2, url: 'https://github.com/someone/demo/issues/2' });
    assert.equal(toAppDto(appRow([active]), { graceMs: 60_000, storedImages: new Set() }).issue, null);
  });

  it('a release reads the same alone as in the header', () => {
    const extra = { graceMs: 60_000, storedImages: new Set(['img:b']), rollbackBlocked: () => null };
    const alone = toReleaseDto(active, extra);
    assert.deepEqual(toAppDto(appRow([active]), extra).release, alone);
    assert.equal(alone.graceEndsAt, at(6).toISOString());
    assert.equal(alone.imageStored, true);
    assert.equal(alone.rollbackBlockedBy, null);
  });
});

describe('the Incidents screen (GET /api/apps/:slug/incidents)', () => {
  const rows = (n) =>
    Array.from({ length: n }, (_, i) => ({
      id: `i${i}`,
      appId: 'a1',
      app: { slug: 'demo', repoFullName: 'someone/demo' },
      alertName: 'KairoAppDown',
      cause: 'down',
      status: 'RESOLVED',
      startedAt: at(50 - i),
      resolvedAt: at(51 - i),
      attempts: [],
    }));

  function fakeDb(total) {
    const seen = [];
    stub(prisma.app, 'findFirst', async () => ({ id: 'a1', slug: 'demo' }));
    stub(prisma.incident, 'findFirst', async ({ where }) => (where.id === 'i3' && where.appId === 'a1' ? { id: 'i3' } : null));
    stub(prisma.incident, 'findMany', async (args) => {
      seen.push(args);
      return rows(total).slice(args.skip ? 4 : 0).slice(0, args.take);
    });
    return seen;
  }

  it('asks for one more than it shows, to know if there are older ones', async () => {
    const seen = fakeDb(30);
    const page = await getAppIncidents('demo', {});
    assert.equal(page.incidents.length, INCIDENT_PAGE.default);
    assert.equal(page.more, true);
    assert.equal(seen[0].take, INCIDENT_PAGE.default + 1);
    assert.deepEqual(seen[0].where, { appId: 'a1' });
    assert.deepEqual(seen[0].orderBy, [{ startedAt: 'desc' }, { id: 'desc' }]);
  });

  it('the Overview asks for 3', async () => {
    fakeDb(10);
    const page = await getAppIncidents('demo', { limit: '3' });
    assert.deepEqual(
      page.incidents.map((i) => i.id),
      ['i0', 'i1', 'i2'],
    );
    assert.equal(page.more, true);
  });

  it('Show older starts just past the given incident', async () => {
    const seen = fakeDb(10);
    const page = await getAppIncidents('demo', { before: 'i3' });
    assert.deepEqual(seen[0].cursor, { id: 'i3' });
    assert.equal(seen[0].skip, 1);
    assert.equal(page.incidents[0].id, 'i4');
    assert.equal(page.more, false);
  });

  it('refuses a bad limit, and an incident from another app as the cursor', async () => {
    fakeDb(1);
    for (const limit of ['0', '51', 'x', '2.5', '']) {
      await assert.rejects(getAppIncidents('demo', { limit }), { statusCode: 400 }, `limit ${JSON.stringify(limit)}`);
    }
    await assert.rejects(getAppIncidents('demo', { before: 'not-ours' }), { statusCode: 400 });
    await assert.rejects(getAppIncidents('demo', { before: ['i3', 'i4'] }), { statusCode: 400 });
  });

  it('a deleted or unknown app is a 404', async () => {
    stub(prisma.app, 'findFirst', async () => null);
    await assert.rejects(getAppIncidents('gone', {}), { statusCode: 404 });
  });
});

describe('Newer and Older on the incident page', () => {
  const row = { id: 'm', appId: 'a1', startedAt: at(10) };
  const q = neighbourQueries(row);

  it('stays within the app', () => {
    assert.equal(q.newer.where.appId, 'a1');
    assert.equal(q.older.where.appId, 'a1');
  });

  it('newer is the closest later one, older the closest earlier one', () => {
    assert.deepEqual(q.newer.orderBy, [{ startedAt: 'asc' }, { id: 'asc' }]);
    assert.deepEqual(q.older.orderBy, [{ startedAt: 'desc' }, { id: 'desc' }]);
    assert.deepEqual(q.newer.where.OR[0], { startedAt: { gt: at(10) } });
    assert.deepEqual(q.older.where.OR[0], { startedAt: { lt: at(10) } });
  });

  it('two incidents that started in the same second are told apart by id, as the lists order them', () => {
    assert.deepEqual(q.newer.where.OR[1], { startedAt: at(10), id: { gt: 'm' } });
    assert.deepEqual(q.older.where.OR[1], { startedAt: at(10), id: { lt: 'm' } });
  });
});
