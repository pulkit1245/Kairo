// How each enum value looks on screen: a word, an icon and a tone.
// Words follow the Stitch screens (docs/planning/design/stitch/README.md).
import { IN_PROGRESS_STATUSES } from '../../types/enums.js';

const title = (s) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll('_', ' ');

// tone -> text color class. Kept here so every badge uses the same palette
export const TONE_CLASS = {
  ok: 'text-tertiary',
  busy: 'text-primary',
  bad: 'text-error',
  warn: 'text-warning',
  muted: 'text-on-surface-variant',
};

// A run in P0 ends at GENERATING (build and deploy come in P1), so a finished
// run that isn't RUNNING or FAILED shows as done at that step, not as busy.
export function runStatus(run) {
  if (run.status === 'FAILED') return { label: 'Failed', icon: 'error', tone: 'bad' };
  if (run.status === 'RUNNING') return { label: 'Running', icon: 'check_circle', tone: 'ok' };
  if (!run.finishedAt && IN_PROGRESS_STATUSES.includes(run.status)) {
    return { label: title(run.status), icon: 'progress_activity', tone: 'busy', spin: true };
  }
  return { label: `${title(run.status)} done`, icon: 'task_alt', tone: 'ok' };
}

export const stackLabel = (stack) => (stack === 'NODE' ? 'Node.js' : stack === 'PYTHON' ? 'Python' : '—');
