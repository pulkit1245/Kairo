import { createLogger } from '../utils/logger.js';

// The scheduler (AQ4, decided 10 Nov): plain in-process timers. A tick is
// skipped while the previous one is still running, so a slow GitHub call
// never piles up. No job library.

const log = createLogger('jobs');

export function every(name, intervalMs, job) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await job();
    } catch (err) {
      log.error(`${name} failed`, err);
    } finally {
      running = false;
    }
  }, intervalMs);
  // never keeps the process alive on its own
  timer.unref();
  return timer;
}
