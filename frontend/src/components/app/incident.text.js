// How an incident reads on the app page and in the drawer (Stitch 07, 08).
// One place, so the list, the drawer's title and its timeline say the same.
import { shortSha } from '../common/format.js';

const ALERT_TITLE = {
  KairoOOMKilled: 'Memory limit hit',
  KairoCrashLoop: 'Crash loop',
  KairoAppDown: 'Not answering',
  KairoHighCpu: 'High CPU',
  KairoHighLatency: 'Slow answers',
};

// a person's rollback from the release list (FR-61): Kairo records it as an
// incident of its own, with no alert behind it
export const MANUAL_ROLLBACK = 'ManualRollback';
export const isManual = (incident) => incident.alertName === MANUAL_ROLLBACK;

const DONE = {
  RESTART: 'pod restarted',
  ROLLBACK: 'rolled back',
  SCALE_UP: 'scaled up',
  SCALE_DOWN: 'scaled down',
};

// what kind of incident, in a few lower-case words, for the Apps list's
// "Last incident: crash loop, 2 min ago"
export function incidentKind(incident) {
  if (isManual(incident)) return 'manual rollback';
  const title = ALERT_TITLE[incident.alertName];
  return title ? title.toLowerCase() : incident.alertName;
}

// the first action that ran decides the title, e.g. "Crash loop, rolled back"
export function incidentTitle(incident) {
  if (isManual(incident)) {
    const to = incident.attempts[0]?.toSha;
    return to ? `Manual rollback to ${shortSha(to)}` : 'Manual rollback';
  }
  const alert = ALERT_TITLE[incident.alertName] ?? incident.alertName;
  const acted = incident.attempts.find((a) => a.result !== 'SKIPPED' && a.result !== 'FAILED' && DONE[a.action]);
  if (acted) return `${alert}, ${DONE[acted.action]}`;
  if (incident.attempts.some((a) => a.result === 'SKIPPED')) return `${alert}, no action`;
  return alert;
}

// "Restart", "Rollback to 9c8a2b0", "Scale up"
export function actionText(attempt) {
  if (attempt.action === 'ROLLBACK') return attempt.toSha ? `Rollback to ${shortSha(attempt.toSha)}` : 'Rollback';
  if (attempt.action === 'SCALE_UP') return 'Scale up';
  if (attempt.action === 'SCALE_DOWN') return 'Scale down';
  if (attempt.action === 'NONE') return 'No action';
  return 'Restart';
}

// what the action did, for the timeline
export function actionDetail(attempt, incident) {
  const why = attempt.reason ? ` Reason: ${attempt.reason}.` : '';
  if (attempt.result === 'SKIPPED') {
    return attempt.action === 'NONE'
      ? 'Kairo has no action for this alert.'
      : `Kairo didn't act${attempt.dryRun ? ' (dry run)' : ''}. It would have chosen: ${actionText(attempt).toLowerCase()}.${why}`;
  }
  if (attempt.result === 'FAILED') return `The ${actionText(attempt).toLowerCase()} itself failed.${why}`;
  switch (attempt.action) {
    case 'RESTART':
      return incident.pod
        ? `Kairo deleted pod ${incident.pod}; Kubernetes started a replacement.`
        : 'Kairo deleted the pod; Kubernetes started a replacement.';
    case 'ROLLBACK': {
      const from = attempt.fromSource === 'TEST' ? 'the Break It release' : attempt.fromSha ? shortSha(attempt.fromSha) : null;
      const to = attempt.toSha ? `${shortSha(attempt.toSha)}, ` : '';
      if (attempt.trigger === 'MANUAL') {
        const picked = attempt.toSha ? shortSha(attempt.toSha) : 'the release';
        return `Kairo rolled back${from ? ` from ${from}` : ''} to ${picked}, picked from the release list.`;
      }
      return from
        ? `Kairo rolled back from ${from} to ${to}the last release marked healthy.`
        : `Kairo rolled back to ${to}the last release marked healthy.`;
    }
    case 'SCALE_UP':
      return 'Kairo added a replica (up to 3).';
    case 'SCALE_DOWN':
      return 'The load stayed low for 5 minutes, so Kairo removed a replica.';
    default:
      return '';
  }
}

// the result as one badge: an icon and a word, never color alone
export function attemptBadge(attempt) {
  switch (attempt.result) {
    case 'VERIFIED':
      return { label: 'Verified', icon: 'verified', tone: 'ok' };
    case 'UNVERIFIED':
      return { label: 'Unverified', icon: 'help', tone: 'bad' };
    case 'FAILED':
      return { label: 'Failed', icon: 'error', tone: 'bad' };
    case 'SKIPPED':
      return { label: attempt.dryRun ? 'Skipped (dry run)' : 'Skipped', icon: 'skip_next', tone: 'muted' };
    default:
      return { label: 'Checking', icon: 'progress_activity', tone: 'busy', spin: true };
  }
}

// the incident's own badge in the list: open, or how it ended
export function incidentBadge(incident) {
  const last = incident.attempts.at(-1);
  if (incident.status === 'OPEN') return { label: 'Open', icon: 'warning', tone: 'warn' };
  if (last?.result === 'UNVERIFIED') return { label: 'Resolved, unverified', icon: 'help', tone: 'warn' };
  return { label: 'Resolved', icon: 'check_circle', tone: 'ok' };
}
