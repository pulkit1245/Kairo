import { prisma } from '../db/index.js';
import { toAppDto } from '../models/dto.mapper.js';
import { GRACE_MS } from '../shipping/grace.service.js';
import { storedImages } from '../shipping/prune.service.js';
import { NotFoundError } from '../utils/AppError.js';

// How many releases the app page lists. Pruning keeps 3 images (FR-38); the
// rest stay listed so the history reads right, marked as no longer stored.
const RELEASES_SHOWN = 10;

// GET /api/apps/:slug: the app page (P2c header, P3 fills in the rest)
export async function getApp(slug) {
  const app = await prisma.app.findFirst({
    where: { slug, deletedAt: null },
    include: {
      releases: { orderBy: { deployedAt: 'desc' } },
      pipelineRuns: { orderBy: { startedAt: 'desc' }, take: 1 },
    },
  });
  if (!app) throw new NotFoundError('App');
  return toAppDto(
    { ...app, releases: app.releases.slice(0, RELEASES_SHOWN) },
    { graceMs: GRACE_MS, storedImages: storedImages(app.releases) },
  );
}
