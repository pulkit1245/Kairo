import { useState } from 'react';
import { rollbackTo } from '../../services/api.js';
import { relativeTime, shortSha } from '../common/format.js';
import { Icon } from '../common/Icon.jsx';
import { TONE_CLASS } from '../common/status.js';

// Releases of one app, newest first (FR-60, Stitch 07 and 10). Earlier
// releases that were marked healthy and whose image is still stored get
// "Roll back to this" (FR-61): the same path as an automatic rollback, grace
// window and 90 s check included, recorded with trigger MANUAL. It asks once
// before it goes out. The backend says when it can't run now and why
// (release.rollbackBlockedBy), e.g. during a grace window.

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

// offered at all: an earlier healthy release with its image (Break It's never is)
export const offersRollback = (r) => r.status !== 'ACTIVE' && Boolean(r.healthyAt) && r.imageStored && r.source !== 'TEST';

export function ReleaseTable({ slug, releases, now, onRolledBack }) {
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  async function rollBack(r) {
    setBusy(r.id);
    setMessage(null);
    try {
      const res = await rollbackTo(slug, r.id);
      const ran = res.attempt?.result !== 'FAILED';
      setMessage({
        tone: ran ? 'ok' : 'bad',
        text: ran
          ? `Rolled back to ${shortSha(r.commitSha)}. Kairo is checking it (up to 90 s); the incident list shows the result.`
          : `The rollback failed: ${res.note}`,
      });
      onRolledBack?.();
    } catch (err) {
      setMessage({ tone: 'bad', text: err.message });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse">
          <thead className="border-b border-outline-variant">
            <tr>
              <th className={th}>Commit</th>
              <th className={th}>Message</th>
              <th className={th}>Image from</th>
              <th className={th}>Deployed</th>
              <th className={th}>Health</th>
              <th className={`${th} text-right`}>Status</th>
              <th className={`${th} text-right`}>
                <span className="sr-only">Actions</span>
              </th>
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
                    {/* Break It's shared image is never pruned, and never a rollback target either */}
                    {!r.imageStored && r.source !== 'TEST' && <span className="block text-code-sm text-on-surface-variant">image pruned</span>}
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
                  <td className={`${td} text-right`}>
                    {offersRollback(r) && (
                      <RollbackButton
                        release={r}
                        confirming={confirming === r.id}
                        busy={busy === r.id}
                        disabled={Boolean(busy)}
                        onAsk={() => setConfirming(r.id)}
                        onCancel={() => setConfirming(null)}
                        onConfirm={() => rollBack(r)}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {message && (
        <p role="status" className={`px-4 font-mono text-code-md ${message.tone === 'bad' ? 'text-error' : 'text-tertiary'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

const BUTTON =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2.5 py-1 font-mono text-code-sm disabled:cursor-not-allowed disabled:opacity-50';

function RollbackButton({ release, confirming, busy, disabled, onAsk, onCancel, onConfirm }) {
  const blocked = release.rollbackBlockedBy;
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={onAsk}
        disabled={disabled || Boolean(blocked)}
        title={blocked ? `Not now: ${blocked}` : `Roll back to ${shortSha(release.commitSha)}`}
        className={`${BUTTON} border-outline-variant text-on-surface hover:bg-surface-container-high`}
      >
        <Icon name="history" className="text-[15px]" /> Roll back to this
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={onCancel} disabled={busy} className={`${BUTTON} border-outline-variant text-on-surface-variant`}>
        Cancel
      </button>
      <button type="button" onClick={onConfirm} disabled={busy} className={`${BUTTON} border-error bg-error-container text-on-surface hover:brightness-110`}>
        <Icon name={busy ? 'progress_activity' : 'check'} spin={busy} className="text-[15px]" /> Roll back to {shortSha(release.commitSha)}
      </button>
    </span>
  );
}
