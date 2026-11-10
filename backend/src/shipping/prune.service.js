import { prisma } from '../db/index.js';
import { docker } from '../utils/docker.js';
import { createLogger } from '../utils/logger.js';

// FR-38: keep the images of an app's last 3 releases, prune the older ones, so
// the laptop's disk doesn't fill up. The newest healthy release's image is
// never pruned, because it is the rollback target (FR-50).
//
// "Image still stored" (FR-50, P3) means "in storedImages()": a release whose
// image was pruned is no longer a rollback target.

const log = createLogger('prune');

export const KEEP_RELEASES = 3;

/**
 * Which releases keep their image: the newest 3 that went live (FAILED ones
 * never ran, so they don't take a place), the ACTIVE one and the newest
 * healthy one. The last two are almost always among the 3 already.
 * @param {Array<{ id: string, status: string, healthyAt: Date | null, deployedAt: Date }>} releases
 * @returns {Set<string>} release ids
 */
export function keptReleases(releases) {
  const newestFirst = [...releases].sort((a, b) => new Date(b.deployedAt) - new Date(a.deployedAt));
  const live = newestFirst.filter((r) => r.status !== 'FAILED');
  const keep = new Set(live.slice(0, KEEP_RELEASES).map((r) => r.id));
  const active = newestFirst.find((r) => r.status === 'ACTIVE');
  if (active) keep.add(active.id);
  const healthy = newestFirst.find((r) => r.healthyAt);
  if (healthy) keep.add(healthy.id);
  return keep;
}

// The images the kept releases use. Re-deploying one commit makes several
// releases of one image, so an older release can still have its image
export function storedImages(releases) {
  const keep = keptReleases(releases);
  return new Set(releases.filter((r) => keep.has(r.id)).map((r) => r.imageRef));
}

// Image refs to remove: those of releases outside the kept set, unless a kept
// release uses the same image
export function imagesToPrune(releases) {
  const stored = storedImages(releases);
  return [...new Set(releases.map((r) => r.imageRef))].filter((ref) => !stored.has(ref));
}

// Runs after every new ACTIVE release (preview or GHCR). Never throws: a
// failed prune only means the disk holds a little more until next time.
export async function pruneImages(appId) {
  try {
    const app = await prisma.app.findUnique({
      where: { id: appId },
      select: { slug: true, releases: { select: { id: true, imageRef: true, status: true, healthyAt: true, deployedAt: true } } },
    });
    if (!app) return { removed: [] };
    const removed = [];
    for (const ref of imagesToPrune(app.releases)) {
      const { code, output } = await docker(['image', 'rm', ref]);
      if (code === 0) removed.push(ref);
      else if (/No such image/i.test(output)) continue; // already gone, or never pulled here
      else log.debug(`${app.slug}: kept ${ref} for now: ${output.split('\n')[0]}`); // e.g. a stopped container still uses it
    }
    if (removed.length) log.info(`${app.slug}: pruned ${removed.length} old image(s): ${removed.map(short).join(', ')}`);
    return { removed };
  } catch (err) {
    log.warn(`image pruning failed: ${err instanceof Error ? err.message : String(err)}`);
    return { removed: [] };
  }
}

// ghcr.io/punitxd/kairo-node-sample:abc1234…  ->  …kairo-node-sample:abc1234
const short = (ref) => ref.replace(/^.*\//, '').replace(/:([0-9a-f]{7})[0-9a-f]+$/, ':$1');
