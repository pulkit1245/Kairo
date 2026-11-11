import { prisma } from '../db/index.js';
import { k8sErrorMessage, newestPodLog } from '../kubernetes/k8s.client.js';
import { AppError, NotFoundError } from '../utils/AppError.js';

// GET /api/apps/:slug/logs (FR-58): the newest pod's last 50 lines. The page
// asks again every 5 s; nothing is stored.
export const LOG_LINES = 50;

// "2026-11-11T21:26:28.123456789Z GET / 200" -> { time, text }
export function parseLogLine(line) {
  const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) ?(.*)$/.exec(line);
  return m ? { time: m[1], text: m[2] } : { time: null, text: line };
}

export async function appLogs(slug) {
  const app = await prisma.app.findFirst({ where: { slug, deletedAt: null }, select: { slug: true, namespace: true } });
  if (!app) throw new NotFoundError('App');
  let log;
  try {
    log = await newestPodLog(app.namespace, app.slug, LOG_LINES);
  } catch (err) {
    throw new AppError(`Could not read the app's logs: ${k8sErrorMessage(err)}`, 502);
  }
  const lines = log ? log.text.split('\n').filter((l) => l !== '').map(parseLogLine) : [];
  return {
    pod: log?.pod ?? null,
    // true when the container is waiting to restart and this is its last run
    previous: log?.previous ?? false,
    lines,
    fetchedAt: new Date().toISOString(),
  };
}
