import { useEffect, useMemo, useRef } from 'react';
import { duration, relativeTime, utcClock, utcStamp } from '../common/format.js';
import { Icon } from '../common/Icon.jsx';
import { StatusBadge } from '../common/StatusBadge.jsx';
import { TONE_CLASS } from '../common/status.js';
import { ChartCanvas } from '../operations/ChartCanvas.jsx';
import { themeColor } from '../operations/chart.setup.js';
import { usePoll } from '../../hooks/usePoll.js';
import { getIncident } from '../../services/api.js';
import { actionDetail, actionText, attemptBadge, incidentTitle } from './incident.text.js';

// The incident drawer (Stitch 08): what happened, the pods' memory around
// it, a timeline and the attempts. Refreshes every 5 s while the incident is
// open or an action is still being checked. Escape or the backdrop closes it.
const POLL_MS = 5000;
const MiB = 1024 * 1024;

export function IncidentDrawer({ id, onClose }) {
  const settled = (i) => i && i.status === 'RESOLVED' && i.attempts.every((a) => a.result !== 'APPLIED');
  const { data: incident, error } = usePoll(() => getIncident(id), (i) => (settled(i) ? null : POLL_MS), [id]);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-surface-container-lowest/70" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="incident-title"
        className="relative flex h-full w-full max-w-[640px] flex-col border-l border-outline-variant bg-surface-container-low shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-outline-variant px-5 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {incident ? <Header incident={incident} /> : <p className="text-on-surface-variant">{error ? error.message : 'Loading…'}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded border border-outline-variant hover:bg-surface-container-high"
          >
            <Icon name="close" label="Close" className="text-[18px]" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          {incident && (
            <>
              <Explanation incident={incident} />
              <MemoryChart incident={incident} />
              <Timeline incident={incident} />
              <Attempts incident={incident} />
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-outline-variant px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-outline-variant px-4 py-1.5 font-mono text-code-md hover:bg-surface-container-high"
          >
            Close
          </button>
        </div>
      </aside>
    </div>
  );
}

function Header({ incident: i }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 font-mono text-code-md">
        <span className="rounded bg-surface-container-highest px-1.5 py-0.5 text-primary">#{i.id.slice(-6)}</span>
        <span className="text-on-surface-variant">
          {utcStamp(i.startedAt)} ({relativeTime(i.startedAt)})
        </span>
      </div>
      <h2 id="incident-title" className="text-headline-lg font-semibold">
        {incidentTitle(i)}
      </h2>
      <p className="text-body-md text-on-surface-variant">{i.cause}</p>
      <div className="flex flex-wrap items-center gap-2 font-mono text-code-sm">
        <span className="rounded border border-error/40 bg-error-container/20 px-2 py-0.5 text-error">{i.alertName}</span>
        {i.status === 'RESOLVED' ? (
          <span className="inline-flex items-center gap-1 rounded border border-tertiary/30 bg-tertiary/10 px-2 py-0.5 text-tertiary">
            <Icon name="check_circle" className="text-[14px]" /> Recovered in {i.recoverySeconds} s
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning">
            <Icon name="warning" className="text-[14px]" /> Open
          </span>
        )}
        {i.pod && (
          <span className="inline-flex items-center gap-1 rounded border border-outline-variant bg-surface-container px-2 py-0.5 text-on-surface-variant">
            <Icon name="dns" className="text-[14px]" /> Pod: {i.pod}
          </span>
        )}
      </div>
    </>
  );
}

// Gemini's explanation (FR-53) arrives in P4; until then the slot says so
function Explanation({ incident }) {
  return (
    <section className="flex flex-col gap-2 rounded border border-outline-variant bg-surface-container px-4 py-3">
      <h3 className="flex items-center gap-2 text-headline-md font-semibold">
        <Icon name="psychology" className="text-[20px] text-primary" /> What happened
      </h3>
      {incident.explanation ? (
        <p className="text-body-lg">{incident.explanation}</p>
      ) : (
        <p className="text-body-md text-on-surface-variant">
          No explanation yet. Gemini will explain incidents from the pod's logs here; until then, the cause above is Kairo's rule-based
          reading of the alert.
        </p>
      )}
    </section>
  );
}

function MemoryChart({ incident }) {
  const m = incident.memory;
  const colors = useMemo(
    () => ({ focus: themeColor('primary'), other: themeColor('outline'), limit: themeColor('error'), fired: themeColor('error'), ok: themeColor('tertiary'), act: themeColor('secondary') }),
    [],
  );

  const chart = useMemo(() => {
    const limit = m.limitBytes / MiB;
    const markers = [
      { x: Date.parse(incident.startedAt), label: `Alert ${utcClock(incident.startedAt, true)}`, color: colors.fired },
      ...incident.attempts
        .filter((a) => a.result !== 'SKIPPED')
        .map((a) => ({ x: Date.parse(a.attemptedAt), label: actionText(a).split(' to ')[0], color: colors.act })),
      ...(incident.resolvedAt ? [{ x: Date.parse(incident.resolvedAt), label: 'Resolved', color: colors.ok }] : []),
    ];
    return {
      data: {
        datasets: [
          ...m.pods.map((p) => ({
            label: p.pod,
            data: p.points.map(([t, v]) => ({ x: t * 1000, y: v === null ? null : v / MiB })),
            borderColor: p.pod === m.pod ? colors.focus : colors.other,
            borderWidth: p.pod === m.pod ? 2 : 1.5,
          })),
          {
            label: `Limit (${limit} MiB)`,
            data: [
              { x: m.startSec * 1000, y: limit },
              { x: m.endSec * 1000, y: limit },
            ],
            borderColor: colors.limit,
            borderWidth: 1,
            borderDash: [4, 4],
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', intersect: false },
        elements: { point: { radius: 0, hoverRadius: 3 }, line: { tension: 0.2 } },
        scales: {
          x: { type: 'linear', min: m.startSec * 1000, max: m.endSec * 1000, grid: { display: false }, ticks: { callback: (v) => utcClock(v, true), maxRotation: 0, maxTicksLimit: 5 } },
          y: { beginAtZero: true, max: Math.ceil((limit * 1.15) / 32) * 32, title: { display: true, text: 'MiB' } },
        },
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => `${utcClock(items[0].parsed.x, true)} UTC`,
              label: (item) => `${item.dataset.label}: ${Math.round(item.parsed.y)} MiB`,
            },
          },
          markers: { items: markers },
        },
      },
    };
  }, [incident, m, colors]);

  const hasPoints = m.pods.some((p) => p.points.length > 0);
  return (
    <section className="flex flex-col gap-2 rounded border border-outline-variant bg-surface-container px-4 py-3">
      <header className="flex items-center justify-between gap-2 font-mono text-code-md">
        <h3 className="flex items-center gap-2 uppercase tracking-wider text-on-surface-variant">
          <Icon name="monitoring" className="text-[16px]" /> Pod memory (MiB)
        </h3>
        <span className="text-on-surface-variant">Limit: {m.limitBytes / MiB} MiB</span>
      </header>
      {hasPoints ? (
        <>
          <ChartCanvas type="line" data={chart.data} options={chart.options} height={200} label="Memory of the app's pods around the incident" />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-code-sm">
            {m.pods.map((p) => (
              <li key={p.pod} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: p.pod === m.pod ? colors.focus : colors.other }} aria-hidden="true" />
                <span className={p.pod === m.pod ? 'text-primary' : 'text-on-surface-variant'}>
                  {p.pod}
                  {p.pod === m.pod ? ' (this incident)' : ''}
                </span>
              </li>
            ))}
            {m.pod && !m.pods.some((p) => p.pod === m.pod) && (
              <li className="text-on-surface-variant">Prometheus has no memory samples for {m.pod}</li>
            )}
          </ul>
        </>
      ) : (
        <p className="py-6 text-center text-body-md text-on-surface-variant">
          {m.error ?? 'No memory data for this time. Prometheus keeps one day.'}
        </p>
      )}
    </section>
  );
}

// alert fired, each action and its check, resolved: in time order, with T+s
function events(i) {
  const list = [{ t: i.startedAt, title: 'Alert fired', text: i.cause, icon: 'warning', tone: 'bad' }];
  for (const a of i.attempts) {
    const badge = attemptBadge(a);
    list.push({
      t: a.attemptedAt,
      title: actionText(a) + (a.trigger === 'MANUAL' ? ' (manual)' : ''),
      text: actionDetail(a, i),
      icon: a.result === 'SKIPPED' ? 'skip_next' : 'bolt',
      tone: a.result === 'SKIPPED' ? 'muted' : 'busy',
    });
    if (a.result === 'VERIFIED' && a.verifiedAt) {
      list.push({
        t: a.verifiedAt,
        title: 'Verified',
        text: `Checked ${duration(a.attemptedAt, a.verifiedAt)} after the action: every replica ready on the intended release.`,
        icon: 'verified',
        tone: 'ok',
      });
    } else if (a.result === 'UNVERIFIED') {
      list.push({
        t: new Date(Date.parse(a.attemptedAt) + 90_000).toISOString(),
        title: 'Unverified',
        text: "Not confirmed within 90 s, so Kairo stopped acting on the app and it needs attention.",
        icon: 'help',
        tone: 'bad',
      });
    } else if (badge.label === 'Checking') {
      list.push({ t: null, title: 'Checking', text: 'Kairo is checking that the action took effect (up to 90 s).', icon: 'progress_activity', tone: 'busy', spin: true });
    }
  }
  if (i.resolvedAt) {
    list.push({ t: i.resolvedAt, title: 'Alert resolved', text: 'Prometheus marked the alert resolved.', icon: 'check_circle', tone: 'ok' });
  }
  const at = (e) => (e.t ? Date.parse(e.t) : Infinity);
  return list.sort((a, b) => at(a) - at(b));
}

// "14 s", "6 min 16 s"
function since(start, iso) {
  const s = Math.round((Date.parse(iso) - start) / 1000);
  return s < 120 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function Timeline({ incident }) {
  const list = events(incident);
  const start = Date.parse(incident.startedAt);
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h3 className="text-headline-md font-semibold">Timeline</h3>
        <span className="rounded bg-tertiary/10 px-2 py-0.5 font-mono text-code-sm text-tertiary">{list.length} events</span>
      </header>
      <ol className="relative flex flex-col gap-4 border-l border-outline-variant pl-5">
        {list.map((e, n) => (
          <li key={n} className="relative">
            <span className={`absolute -left-[31px] top-0 grid size-5 place-items-center rounded-full bg-surface-container-high ${TONE_CLASS[e.tone]}`}>
              <Icon name={e.icon} spin={e.spin} className="text-[14px]" />
            </span>
            <div className="flex items-baseline justify-between gap-2 font-mono text-code-md">
              <span className={`${TONE_CLASS[e.tone]} uppercase`}>
                {e.t ? `${utcClock(e.t, true)} UTC · ` : ''}
                {e.title}
              </span>
              {e.t && <span className="shrink-0 text-on-surface-variant">T+{since(start, e.t)}</span>}
            </div>
            <p className="text-body-md">{e.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Attempts({ incident }) {
  const th = 'px-3 py-2 text-left font-mono text-code-sm uppercase tracking-wider text-on-surface-variant font-normal';
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-headline-md font-semibold">Attempts</h3>
      {incident.attempts.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">None recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-outline-variant">
          <table className="w-full border-collapse">
            <thead className="border-b border-outline-variant bg-surface-container">
              <tr>
                <th className={th}>Action</th>
                <th className={th}>Result</th>
                <th className={`${th} text-right`}>Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {incident.attempts.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2 font-mono text-code-md text-primary">
                    {actionText(a)}
                    {a.trigger === 'MANUAL' && <span className="text-on-surface-variant"> · manual</span>}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={attemptBadge(a)} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-code-md">
                    {utcClock(a.attemptedAt, true)} UTC
                    {a.verifiedAt && <span className="text-tertiary"> ({duration(a.attemptedAt, a.verifiedAt)})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
