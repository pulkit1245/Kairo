import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { prisma } from '../../src/db/index.js';
import { offersRollback, rollbackOffers, toAppDto, toIncidentDto, toReleaseDto } from '../../src/models/dto.mapper.js';
import { getAppIncidents, INCIDENT_PAGE, neighbourQueries } from '../../src/services/app.service.js';
import { windowActions } from '../../src/services/metrics.service.js';

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
    assert.equal(dto([active, release('a'), release('d', { imageRef: 'img:d' })], new Set(['img:a', 'img:d'])).rollbackTargets, 2);
    // P5e: one per image, so a commit deployed twice counts once
    assert.equal(dto([active, release('a'), release('c', { imageRef: 'img:a' })]).rollbackTargets, 1);
    assert.equal(dto([active]).rollbackTargets, 0);
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

  it('offers "Roll back to this" once per image, on its newest offered release', () => {
    const newer = release('n', { imageRef: 'img:a', deployedAt: at(3) });
    const older = release('o', { imageRef: 'img:a', deployedAt: at(1) });
    const unhealthyNewest = release('u', { imageRef: 'img:a', deployedAt: at(4), healthyAt: null });
    const other = release('x', { deployedAt: at(2) });
    const ids = rollbackOffers([active, unhealthyNewest, newer, other, older], new Set(['img:a', 'img:x']));
    assert.deepEqual([...ids].sort(), ['n', 'x'], 'the never-healthy newest is skipped, its older healthy twin offered');
    const dto = toAppDto(appRow([active, newer, older]), { graceMs: 60_000, storedImages: new Set(['img:a']) });
    assert.equal(dto.rollbackTargets, 1);
    const extra = { graceMs: 60_000, storedImages: new Set(['img:a']), offered: rollbackOffers([active, newer, older], new Set(['img:a'])) };
    assert.deepEqual([newer, older].map((r) => toReleaseDto(r, extra).offersRollback), [true, false]);
  });

  it("an incident carries when and how Kairo reported it on GitHub", () => {
    const row = { id: 'i1', appId: 'a1', app: { slug: 'demo', repoFullName: 'someone/demo' }, alertName: 'KairoCrashLoop', cause: 'c', status: 'RESOLVED', startedAt: at(0), resolvedAt: at(1), recoverySeconds: 30, attempts: [] };
    const reported = toIncidentDto({ ...row, githubIssueNumber: 2, githubIssueAt: at(0), githubIssueOpened: false });
    assert.equal(reported.githubIssueAt, at(0).toISOString());
    assert.equal(reported.githubIssueOpened, false);
    const before = toIncidentDto({ ...row, githubIssueNumber: 2 });
    assert.equal(before.githubIssueAt, null, 'older incidents have no time');
    assert.equal(before.githubIssueOpened, null);
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

describe("the charts' markers come with the metrics", () => {
  it("are the app's actions in the window that changed something, oldest first", async () => {
    let asked;
    stub(prisma.remediationAttempt, 'findMany', async (args) => {
      asked = args;
      return [
        { action: 'SCALE_UP', result: 'VERIFIED', attemptedAt: at(20), toRelease: null },
        { action: 'ROLLBACK', result: 'APPLIED', attemptedAt: at(25), toRelease: { commitSha: 'f485a2e3' } },
      ];
    });
    const startSec = at(5).getTime() / 1000;
    const actions = await windowActions('a1', startSec);
    assert.deepEqual(asked.where, { incident: { appId: 'a1' }, attemptedAt: { gte: at(5) }, result: { not: 'SKIPPED' } });
    assert.deepEqual(asked.orderBy, { attemptedAt: 'asc' });
    assert.deepEqual(actions, [
      { action: 'SCALE_UP', result: 'VERIFIED', attemptedAt: at(20).toISOString(), toSha: null },
      { action: 'ROLLBACK', result: 'APPLIED', attemptedAt: at(25).toISOString(), toSha: 'f485a2e3' },
    ]);
  });
});
