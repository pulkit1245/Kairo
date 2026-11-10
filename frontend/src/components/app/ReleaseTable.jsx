import { relativeTime, shortSha } from '../common/format.js';
import { Icon } from '../common/Icon.jsx';
import { TONE_CLASS } from '../common/status.js';

// Releases of one app, newest first (Stitch 07 "Releases"). Read-only in P2:
// "Roll back to this" arrives with P3's rollback.

const th = 'px-4 py-2 text-left font-mono text-code-sm uppercase tracking-wider text-on-surface-variant font-normal';
const td = 'px-4 py-3 align-top';

const STATUS = {
  ACTIVE: { label: 'Active', icon: 'check', tone: 'busy' },
  SUPERSEDED: { label: 'Superseded', icon: 'history', tone: 'muted' },
  ROLLED_BACK: { label: 'Rolled back', icon: 'undo', tone: 'warn' },
  FAILED: { label: 'Failed', icon: 'error', tone: 'bad' },
};

// FR-71, FR-72: healthy once it survives its 60 s grace window
export function releaseHealth(r, now = Date.now()) {
  if (r.healthyAt) return { label: 'Healthy', icon: 'verified', tone: 'ok' };
  if (r.status === 'FAILED') return { label: 'Never ran', icon: 'remove', tone: 'muted' };
  const left = Math.ceil((new Date(r.graceEndsAt).getTime() - now) / 1000);
  if (r.status === 'ACTIVE' && left > 0) return { label: `Grace window · ${left} s`, icon: 'hourglass_top', tone: 'busy' };
  if (r.status === 'ACTIVE' && left > -15) return { label: 'Checking', icon: 'progress_activity', tone: 'busy', spin: true };
  return { label: 'Not marked healthy', icon: 'block', tone: 'warn' };
}

export function ReleaseTable({ releases, now }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead className="border-b border-outline-variant">
          <tr>
            <th className={th}>Commit</th>
            <th className={th}>Message</th>
            <th className={th}>Image from</th>
            <th className={th}>Deployed</th>
            <th className={th}>Health</th>
            <th className={`${th} text-right`}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant">
          {releases.map((r) => {
            const health = releaseHealth(r, now);
            const status = STATUS[r.status];
            const active = r.status === 'ACTIVE';
            return (
              <tr key={r.id} className={active ? 'bg-surface-container' : ''}>
                <td className={`${td} font-mono text-code-md ${active ? 'text-primary' : ''}`} title={r.commitSha}>
                  {shortSha(r.commitSha)}
                </td>
                <td className={`${td} text-body-md`}>{r.commitMessage ?? <span className="text-on-surface-variant">—</span>}</td>
                <td className={`${td} font-mono text-code-md`} title={r.imageRef}>
                  {r.source === 'GHCR' ? 'GHCR' : r.source === 'TEST' ? 'Break It' : 'Preview'}
                  {!r.imageStored && <span className="block text-code-sm text-on-surface-variant">image pruned</span>}
                </td>
                <td className={`${td} text-on-surface-variant`} title={r.deployedAt}>
                  {relativeTime(r.deployedAt, now)}
                </td>
                <td className={td}>
                  <span className={`inline-flex items-center gap-1.5 font-mono text-code-md ${TONE_CLASS[health.tone]}`}>
                    <Icon name={health.icon} spin={health.spin} className="text-[16px]" /> {health.label}
                  </span>
                </td>
                <td className={`${td} text-right`}>
                  <span
                    className={`inline-flex items-center gap-1 font-mono text-code-md ${TONE_CLASS[status.tone]} ${
                      active ? 'rounded border border-primary/50 px-2 py-0.5' : ''
                    }`}
                  >
                    {active && <Icon name={status.icon} className="text-[16px]" />}
                    {status.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
