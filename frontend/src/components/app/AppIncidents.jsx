import { useState } from 'react';
import { duration, utcStamp } from '../common/format.js';
import { Icon } from '../common/Icon.jsx';
import { StatusBadge } from '../common/StatusBadge.jsx';
import { actionText, attemptBadge, incidentBadge } from './incident.text.js';

// The app's incidents (Stitch 07): newest first, filtered All / Open /
// Resolved. Each one opens the incident drawer (Stitch 08).

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'open', label: 'Open', test: (i) => i.status === 'OPEN' },
  { key: 'resolved', label: 'Resolved', test: (i) => i.status === 'RESOLVED' },
];

export function AppIncidents({ incidents, onOpen }) {
  const [filter, setFilter] = useState('all');
  const shown = incidents.filter(FILTERS.find((f) => f.key === filter).test);

  return (
    <section className="flex min-w-0 flex-col rounded border border-outline-variant bg-surface-container-low">
      <header className="flex items-center justify-between gap-3 border-b border-outline-variant px-4 py-3">
        <h2 className="flex items-center gap-2 font-mono text-code-md uppercase tracking-wider text-on-surface-variant">
          <Icon name="healing" className="text-[18px] text-tertiary" /> Incidents
        </h2>
        <div className="flex rounded border border-outline-variant bg-surface-container font-mono text-code-sm" role="group" aria-label="Show incidents">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 ${filter === f.key ? 'bg-surface-container-highest text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      {shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-body-md text-on-surface-variant">
          {incidents.length === 0 ? 'No incidents yet. Try the test panel below.' : 'None here.'}
        </p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-outline-variant overflow-y-auto">
          {shown.map((i) => (
            <li key={i.id}>
              <IncidentRow incident={i} onOpen={() => onOpen(i.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IncidentRow({ incident: i, onOpen }) {
  const badge = incidentBadge(i);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-surface-container ${
        i.status === 'OPEN' ? 'bg-warning/5 shadow-[inset_3px_0_0_var(--color-warning)]' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-code-md text-primary" title={i.startedAt}>
          {utcStamp(i.startedAt)}
        </span>
        <span className="font-mono text-code-sm text-on-surface-variant">{i.alertName}</span>
        <StatusBadge status={badge} className="ml-auto" />
      </div>
      <p className="text-body-md">
        <span className="text-on-surface-variant">Cause: </span>
        {i.cause}
      </p>
      {i.attempts.map((a) => {
        const r = attemptBadge(a);
        return (
          <div key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-code-sm">
            <span className="text-on-surface-variant">Action:</span>
            <span className="rounded bg-surface-container-highest px-1.5 py-0.5 text-primary">{actionText(a)}</span>
            {a.action === 'RESTART' && i.pod && <span className="text-secondary">pod {i.pod}</span>}
            {a.trigger === 'MANUAL' && <span className="text-on-surface-variant">manual</span>}
            <StatusBadge status={r} className="text-code-sm" />
            {a.verifiedAt && <span className="ml-auto text-tertiary">{duration(a.attemptedAt, a.verifiedAt)}</span>}
          </div>
        );
      })}
      {i.attempts.length === 0 && <span className="font-mono text-code-sm text-on-surface-variant">Recording the action…</span>}
      {i.pod && !i.attempts.some((a) => a.action === 'RESTART') && (
        <span className="font-mono text-code-sm text-secondary">pod {i.pod}</span>
      )}
    </button>
  );
}
