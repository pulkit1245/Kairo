import { relativeTime } from '../common/format.js';
import { Icon } from '../common/Icon.jsx';
import { actionLabel, attemptResult, incidentStatus, TONE_CLASS } from '../common/status.js';
import { StatusBadge } from '../common/StatusBadge.jsx';

const th = 'px-4 py-2 text-left font-mono text-code-sm uppercase tracking-wider text-on-surface-variant font-normal';
const td = 'px-4 py-3 align-top';

// one line per action Kairo took, e.g. "Restart · Skipped (dry run)"
function Attempts({ attempts }) {
  // a record can still be on its way (act first, record second, FR-74)
  if (attempts.length === 0) return <span className="text-on-surface-variant">—</span>;
  return (
    <ul className="flex flex-col gap-1">
      {attempts.map((a) => {
        const r = attemptResult(a.result);
        return (
          <li key={a.id} className="flex items-center gap-1.5 font-mono text-code-md">
            <span>{actionLabel(a.action)}</span>
            <span className="text-on-surface-variant">·</span>
            <span className={`inline-flex items-center gap-1 ${TONE_CLASS[r.tone]}`}>
              <Icon name={r.icon} className="text-[14px]" />
              {r.label}
            </span>
            {a.dryRun && <span className="text-on-surface-variant">(dry run)</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function IncidentTable({ incidents }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead className="border-b border-outline-variant">
          <tr>
            <th className={th}>App</th>
            <th className={th}>Alert</th>
            <th className={th}>Status</th>
            <th className={th}>Actions</th>
            <th className={th}>Started</th>
            <th className={`${th} text-right`}>Recovered in</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant">
          {incidents.map((i) => (
            <tr
              key={i.id}
              className={`hover:bg-surface-container ${i.status === 'OPEN' ? 'bg-warning/5 shadow-[inset_3px_0_0_var(--color-warning)]' : ''}`}
            >
              <td className={`${td} font-medium`}>{i.appName}</td>
              <td className={td}>
                <div className="font-mono text-code-md">{i.alertName}</div>
                <div className="text-body-sm text-on-surface-variant">{i.cause}</div>
                {i.pod && <div className="font-mono text-code-sm text-secondary">pod {i.pod}</div>}
              </td>
              <td className={td}>
                <StatusBadge status={incidentStatus(i.status)} />
              </td>
              <td className={td}>
                <Attempts attempts={i.attempts} />
              </td>
              <td className={`${td} text-on-surface-variant`} title={i.startedAt}>
                {relativeTime(i.startedAt)}
              </td>
              <td className={`${td} text-right font-mono text-code-md`}>
                {i.recoverySeconds === null ? '—' : `${i.recoverySeconds} s`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
