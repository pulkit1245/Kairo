import { fileURLToPath } from 'node:url';
import { prisma } from '../db/index.js';
import { deletePod, k8sErrorMessage, listAppPods, setImage } from '../kubernetes/k8s.client.js';
import { inGrace, startGrace } from '../shipping/grace.service.js';
import { beginRollout, endRollout, isRolloutInProgress } from '../state/rollout.state.js';
import { AppError, errorMessage, NotFoundError } from '../utils/AppError.js';
import { docker } from '../utils/docker.js';
import { createLogger } from '../utils/logger.js';

// Break It (FR-63), two ways to hurt an app on purpose:
//
//   kill-pod        deletes the newest pod. Kubernetes replaces it by itself,
//                   which is the point of showing it (PQ1): no Kairo action.
//   broken-release  deploys kairo/broken-release:1, which exits on start. The
//                   rolling update keeps the old pod serving while the new one
//                   crash-loops, KairoCrashLoop fires, and Kairo rolls back to
//                   the last healthy release (FR-46, FR-50).
//
// The broken release is recorded like a rollout: a TEST release, ACTIVE, the
// previous one SUPERSEDED, and a grace window (FR-71). It never gets healthy.

const log = createLogger('break-it');

export const BROKEN_IMAGE = 'kairo/broken-release:1';
const BROKEN_IMAGE_DIR = fileURLToPath(new URL('../../../infra/broken-image', import.meta.url));
export const BREAK_KINDS = ['kill-pod', 'broken-release'];

export async function breakApp(slug, kind) {
  if (!BREAK_KINDS.includes(kind)) throw new AppError(`kind must be one of: ${BREAK_KINDS.join(', ')}`, 400);
  const app = await prisma.app.findFirst({ where: { slug, deletedAt: null } });
  if (!app) throw new NotFoundError('App');
  return kind === 'kill-pod' ? killPod(app) : deployBroken(app);
}

async function killPod(app) {
  const [newest] = await listAppPods(app.namespace, app.slug);
  if (!newest) throw new AppError('The app has no running pod', 409);
  await deletePod(app.namespace, newest);
  log.info(`${app.slug}: deleted pod ${newest}; Kubernetes replaces it on its own`);
  return { kind: 'kill-pod', pod: newest };
}

async function ensureBrokenImage() {
  if ((await docker(['image', 'inspect', BROKEN_IMAGE])).code === 0) return;
  log.info(`building ${BROKEN_IMAGE} from infra/broken-image`);
  const built = await docker(['build', '--tag', BROKEN_IMAGE, BROKEN_IMAGE_DIR], { timeoutMs: 120_000 });
  if (built.code !== 0) throw new AppError(`Could not build ${BROKEN_IMAGE}: ${built.output.split('\n').slice(-1)[0]}`, 500);
}

async function deployBroken(app) {
  if (isRolloutInProgress(app.slug)) throw new AppError('The app is being rolled out; try again in a moment', 409);
  if (inGrace(app.slug)) throw new AppError('The app is in its grace window after a rollout; try again when it ends', 409);
  const active = await prisma.release.findFirst({ where: { appId: app.id, status: 'ACTIVE' }, orderBy: { deployedAt: 'desc' } });
  if (!active) throw new AppError('The app has no running release to break', 409);
  if (active.source === 'TEST') throw new AppError('The broken release is already running', 409);
  await ensureBrokenImage();

  // act: the patch only. Waiting for it would mean waiting for it to fail
  beginRollout(app.slug);
  try {
    await setImage(app.namespace, app.slug, BROKEN_IMAGE);
  } catch (err) {
    throw new AppError(`Could not deploy the broken release: ${k8sErrorMessage(err)}`, 502);
  } finally {
    endRollout(app.slug);
  }
  log.info(`${app.slug}: deployed ${BROKEN_IMAGE}; the old pod keeps serving while the new one crash-loops`);

  // record
  const data = {
    appId: app.id,
    imageRef: BROKEN_IMAGE,
    commitSha: active.commitSha,
    commitMessage: 'Break It: a release that exits on start',
    source: 'TEST',
    status: 'ACTIVE',
  };
  let release;
  try {
    [, release] = await prisma.$transaction([
      prisma.release.updateMany({ where: { appId: app.id, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } }),
      prisma.release.create({ data }),
    ]);
  } catch (err) {
    log.error(`${app.slug}: the broken release is deployed but couldn't be recorded: ${errorMessage(err)}`);
    throw new AppError('The broken release is deployed but could not be recorded', 500);
  }
  startGrace(release, app);
  return { kind: 'broken-release', releaseId: release.id, image: BROKEN_IMAGE };
}
