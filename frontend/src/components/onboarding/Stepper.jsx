import { DEPLOYMENT_STATUSES } from '../../types/enums.js';
import { Icon } from '../common/Icon.jsx';

const STEPS = DEPLOYMENT_STATUSES.filter((s) => s !== 'FAILED');
const label = (s) => s.charAt(0) + s.slice(1).toLowerCase();

// State of every step from the run's status (and failedStep when it failed).
// Only the run's start and finish are stored, so steps show a state, not a time.
export function stepStates(run) {
  const at = run.status === 'FAILED' ? STEPS.indexOf(run.failedStep) : STEPS.indexOf(run.status);
  return STEPS.map((step, i) => {
    if (run.status === 'RUNNING') return 'done';
    if (run.status === 'FAILED') return i < at ? 'done' : i === at ? 'failed' : 'skipped';
    if (i < at) return 'done';
    if (i === at) return run.finishedAt ? 'done' : 'current';
    return run.finishedAt ? 'skipped' : 'pending';
  });
}

const LOOK = {
  done: { icon: 'check_circle', text: 'Done', box: 'border-outline-variant', color: 'text-tertiary' },
  current: { icon: 'progress_activity', text: 'In progress', box: 'border-primary', color: 'text-primary', spin: true },
  failed: { icon: 'cancel', text: 'Failed', box: 'border-error bg-error-container/30', color: 'text-error' },
  pending: { icon: 'radio_button_unchecked', text: 'Waiting', box: 'border-outline-variant', color: 'text-outline' },
  skipped: { icon: 'radio_button_unchecked', text: 'Not started', box: 'border-outline-variant opacity-60', color: 'text-outline' },
};

export function Stepper({ run }) {
  const states = stepStates(run);
  return (
    <ol className="grid grid-cols-2 gap-2 rounded border border-outline-variant bg-surface-container-low p-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Pipeline steps">
      {STEPS.map((step, i) => {
        const look = LOOK[states[i]];
        return (
          <li
            key={step}
            className={`flex items-center gap-2.5 rounded border px-3 py-2.5 ${look.box}`}
            aria-current={states[i] === 'current' ? 'step' : undefined}
          >
            <Icon name={look.icon} spin={look.spin} className={`text-[20px] ${look.color}`} />
            <div className="min-w-0">
              <div className="text-body-lg font-medium">{label(step)}</div>
              <div className={`font-mono text-code-sm ${look.color}`}>{look.text}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
