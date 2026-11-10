import { prisma } from '../../db/index.js';
import { errorMessage } from '../../utils/AppError.js';
import { createLogger } from '../../utils/logger.js';
import * as state from './healing.state.js';

const log = createLogger('health');

// App health (architecture 5.2): HEALTHY -> HEALING -> HEALTHY or
// NEEDS_ATTENTION. Memory decides (FR-74); the App row follows, written after,
// retried once, never waited on by a decision.
export function setAppHealth(slug, health, reason = null) {
  const before = state.getHealth(slug);
  state.setHealthState(slug, health, reason);
  if (health === before && health !== 'NEEDS_ATTENTION') return;
  if (health !== before) log.info(`${slug}: ${before} -> ${health}${reason ? ` (${reason})` : ''}`);
  // the give-up count only starts again when NEEDS_ATTENTION clears (FR-49), not
  // after each verified action: otherwise it could never reach 3 (FR-48)
  if (health === 'HEALTHY' && before === 'NEEDS_ATTENTION') state.clearAttempts(slug);
  writeHealth(slug, health).catch(() => {});
}

async function writeHealth(slug, health) {
  const write = () => prisma.app.updateMany({ where: { slug, deletedAt: null }, data: { health } });
  try {
    await write();
  } catch (first) {
    log.warn(`could not save ${slug}'s health: ${errorMessage(first)}. Retrying once`);
    await new Promise((r) => setTimeout(r, 1000));
    await write().catch((err) => log.error(`could not save ${slug}'s health: ${errorMessage(err)}`));
  }
}

// FR-49 and decision 7: a release newly marked healthy (Deploy again or a
// GHCR rollout) ends NEEDS_ATTENTION. Wired to the grace window in src/index.js
export function clearOnHealthyRelease(slug, release) {
  if (state.getHealth(slug) !== 'NEEDS_ATTENTION') return false;
  setAppHealth(slug, 'HEALTHY');
  log.info(`${slug}: release ${release.commitSha.slice(0, 7)} was marked healthy, so it no longer needs attention`);
  return true;
}

// FR-49, every 60 s (src/index.js): NEEDS_ATTENTION clears once no alert has
// been open for the app for 10 minutes, counted from whichever is later: the
// newest incident's resolve, or the moment it needed attention.
export const ATTENTION_QUIET_MS = 10 * 60 * 1000;

export async function clearQuietApps({ isAlerting, now = Date.now(), db = prisma } = {}) {
  const cleared = [];
  for (const slug of state.slugsNeedingAttention()) {
    if (isAlerting(slug)) continue;
    const since = state.attentionSince(slug) ?? now;
    const newest = await db.incident.findFirst({
      where: { app: { slug, deletedAt: null } },
      orderBy: { startedAt: 'desc' },
      select: { status: true, resolvedAt: true },
    });
    if (newest?.status === 'OPEN') continue;
    const quietSince = Math.max(since, newest?.resolvedAt?.getTime() ?? 0);
    if (now - quietSince < ATTENTION_QUIET_MS) continue;
    setAppHealth(slug, 'HEALTHY');
    log.info(`${slug}: quiet for 10 minutes, no longer needs attention`);
    cleared.push(slug);
  }
  return cleared;
}
