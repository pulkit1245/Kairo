import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { findImage, missingPlatforms, platformsOf } from '../../src/shipping/ghcr.client.js';
import { _resetWatcher, checkApp } from '../../src/shipping/ghcr.watcher.js';
import { _resetGrace, startGrace } from '../../src/shipping/grace.service.js';
import { imagesToPrune, keptReleases } from '../../src/shipping/prune.service.js';
import { beginRollout, endRollout } from '../../src/state/rollout.state.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

// what Buildx pushes: one manifest per platform plus attestations (checked
// against the P0 spike image)
const INDEX = {
  mediaType: 'application/vnd.oci.image.index.v1+json',
  manifests: [
    { platform: { architecture: 'amd64', os: 'linux' } },
    { platform: { architecture: 'arm64', os: 'linux' } },
    { platform: { architecture: 'unknown', os: 'unknown' }, annotations: { 'vnd.docker.reference.type': 'attestation-manifest' } },
    { platform: { architecture: 'unknown', os: 'unknown' }, annotations: { 'vnd.docker.reference.type': 'attestation-manifest' } },
  ],
};

describe('GHCR image check (FR-24, FR-35)', () => {
  it('reads both platforms from an image index and skips attestations', () => {
    assert.deepEqual(platformsOf(INDEX), ['linux/amd64', 'linux/arm64']);
    assert.deepEqual(missingPlatforms(platformsOf(INDEX)), []);
  });

  it('counts a single-platform image as incomplete', () => {
    assert.deepEqual(platformsOf({ mediaType: 'application/vnd.oci.image.manifest.v1+json', layers: [] }), []);
    assert.deepEqual(missingPlatforms(['linux/amd64']), ['linux/arm64']);
  });

  const fakeFetch = (routes) => async (url, opts) => {
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`unexpected ${url}`);
    const [status, body] = typeof hit[1] === 'function' ? hit[1](opts) : hit[1];
    return { ok: status < 300, status, json: async () => body };
  };

  it('asks anonymously, with the lower-case name, and sends the pull token', async () => {
    let auth;
    const res = await findImage(
      'PunitXd/Kairo-Node-Sample',
      SHA_A,
      fakeFetch({
        'token?scope=repository:punitxd/kairo-node-sample:pull': [200, { token: 'anon' }],
        [`/v2/punitxd/kairo-node-sample/manifests/${SHA_A}`]: (opts) => ((auth = opts.headers.Authorization), [200, INDEX]),
      }),
    );
    assert.equal(auth, 'Bearer anon');
    assert.deepEqual(res, { found: true, platforms: ['linux/amd64', 'linux/arm64'], missing: [] });
  });

  it('is not found before the first push, and for a missing tag', async () => {
    const noPackage = await findImage('o/r', SHA_A, fakeFetch({ token: [403, {}] }));
    assert.equal(noPackage.found, false);
    const noTag = await findImage('o/r', SHA_A, fakeFetch({ token: [200, { token: 't' }], manifests: [404, {}] }));
    assert.deepEqual(noTag, { found: false, detail: 'no tag aaaaaaa yet' });
  });
});

describe('GHCR watcher (FR-35 to FR-37)', () => {
  const app = (activeSha = SHA_A) => ({
    id: 'a1',
    slug: 'demo',
    namespace: 'kairo-demo',
    repoFullName: 'PunitXd/demo',
    defaultBranch: 'main',
    installation: { githubInstallationId: 1 },
    releases: activeSha ? [{ id: 'r1', commitSha: activeSha, status: 'ACTIVE' }] : [],
  });

  let rolled;
  const deps = ({ head = SHA_B, image = { found: true, platforms: ['linux/amd64', 'linux/arm64'], missing: [] }, tried = null, running = 0 } = {}) => ({
    getBranchHead: async () => ({ sha: head, message: 'Change the greeting' }),
    findImage: async () => image,
    rollOut: async (a, img) => {
      rolled.push({ a, img });
      return { status: 'ACTIVE' };
    },
    db: {
      pipelineRun: { count: async () => running },
      release: { findFirst: async () => tried },
    },
  });

  beforeEach(() => {
    rolled = [];
    _resetWatcher();
  });
  afterEach(() => {
    _resetGrace();
    endRollout('demo');
  });

  it('rolls out a new commit once its image has both architectures', async () => {
    assert.deepEqual(await checkApp(app(), deps()), { state: 'rolling-out' });
    assert.equal(rolled.length, 1);
    assert.deepEqual(rolled[0].img, {
      commitSha: SHA_B,
      commitMessage: 'Change the greeting',
      imageRef: `ghcr.io/punitxd/demo:${SHA_B}`,
    });
  });

  it('does nothing when the running release is the newest commit', async () => {
    assert.equal((await checkApp(app(SHA_B), deps())).state, 'current');
    assert.equal(rolled.length, 0);
  });

  it('waits for the image, and never rolls out a single-architecture one', async () => {
    assert.equal((await checkApp(app(), deps({ image: { found: false, detail: 'no tag' } }))).state, 'waiting');
    const partial = { found: true, platforms: ['linux/amd64'], missing: ['linux/arm64'] };
    assert.equal((await checkApp(app(), deps({ image: partial }))).state, 'waiting');
    assert.equal(rolled.length, 0);
  });

  it('never retries a commit whose rollout failed (FR-36)', async () => {
    const res = await checkApp(app(), deps({ tried: { status: 'FAILED' } }));
    assert.equal(res.state, 'failed-before');
    assert.equal(rolled.length, 0);
  });

  it('leaves the app alone mid-rollout, in a grace window, or during a pipeline run (FR-37)', async () => {
    beginRollout('demo');
    assert.equal((await checkApp(app(), deps())).state, 'busy');
    endRollout('demo');
    startGrace({ id: 'r1', imageRef: 'x', deployedAt: new Date() }, { slug: 'demo' });
    assert.equal((await checkApp(app(), deps())).state, 'busy');
    _resetGrace();
    assert.equal((await checkApp(app(), deps({ running: 1 }))).state, 'busy');
    assert.equal(rolled.length, 0);
  });

  it('needs a running release to roll out over', async () => {
    assert.equal((await checkApp(app(null), deps())).state, 'no-release');
  });
});

describe('image pruning keep set (FR-38)', () => {
  const at = (min) => new Date(Date.UTC(2026, 10, 11, 12, min));
  const rel = (id, min, status, healthy = false, imageRef = `img:${id}`) => ({
    id,
    imageRef,
    status,
    deployedAt: at(min),
    healthyAt: healthy ? at(min + 1) : null,
  });

  it('keeps the newest 3 and prunes the rest', () => {
    const releases = [
      rel('r1', 1, 'SUPERSEDED', true),
      rel('r2', 2, 'SUPERSEDED', true),
      rel('r3', 3, 'SUPERSEDED', true),
      rel('r4', 4, 'SUPERSEDED', true),
      rel('r5', 5, 'ACTIVE'),
    ];
    assert.deepEqual([...keptReleases(releases)].sort(), ['r3', 'r4', 'r5']);
    assert.deepEqual(imagesToPrune(releases).sort(), ['img:r1', 'img:r2']);
  });

  it('never prunes the newest healthy release, even when it is older than 3', () => {
    const releases = [
      rel('r1', 1, 'SUPERSEDED', true),
      rel('r2', 2, 'SUPERSEDED'),
      rel('r3', 3, 'SUPERSEDED'),
      rel('r4', 4, 'ACTIVE'),
    ];
    assert.deepEqual([...keptReleases(releases)].sort(), ['r1', 'r2', 'r3', 'r4']);
    assert.deepEqual(imagesToPrune(releases), []);
  });

  it("doesn't let failed releases take a place, and prunes their images", () => {
    const releases = [
      rel('r1', 1, 'SUPERSEDED', true),
      rel('r2', 2, 'SUPERSEDED', true),
      rel('r3', 3, 'ACTIVE', true),
      rel('f1', 4, 'FAILED'),
      rel('f2', 5, 'FAILED'),
    ];
    assert.deepEqual([...keptReleases(releases)].sort(), ['r1', 'r2', 'r3']);
    assert.deepEqual(imagesToPrune(releases).sort(), ['img:f1', 'img:f2']);
  });

  it('keeps an image a kept release still uses', () => {
    const same = 'kairo/demo:abc';
    const releases = [
      rel('r1', 1, 'SUPERSEDED', true, same),
      rel('r2', 2, 'SUPERSEDED', true),
      rel('r3', 3, 'SUPERSEDED', true),
      rel('r4', 4, 'ACTIVE', false, same),
    ];
    assert.deepEqual(imagesToPrune(releases), []);
  });
});
