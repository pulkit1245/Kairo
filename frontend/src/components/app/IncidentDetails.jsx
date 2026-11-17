import { useMemo } from 'react';
import { Link } from 'react-router';
import { duration, relativeTime, utcClock, utcStamp } from '../common/format.js';
import { Icon } from '../common/Icon.jsx';
import { StatusBadge } from '../common/StatusBadge.jsx';
import { TONE_CLASS } from '../common/status.js';
import { ChartCanvas } from '../operations/ChartCanvas.jsx';
import { themeColor } from '../operations/chart.setup.js';
import { actionDetail, actionText, attemptBadge, incidentTitle, isManual } from './incident.text.js';

// The parts of an incident's own page (P5d, mockup v2; the drawer before,
// Stitch 08): its header, what happened, the pods' memory around it, a
// timeline and the attempts.
const MiB = 1024 * 1024;

// a bordered panel with the app screens' header bar
function Section({ title, icon, meta, children }) {
  return (
    <section className="flex min-w-0 flex-col rounded border border-outline-variant bg-surface-container-low">
      <header className="flex items-center justify-between gap-3 border-b border-outline-variant px-4 py-3">
        <h2 className="flex items-center gap-2 font-mono text-code-md uppercase tracking-wider text-on-surface-variant">
          <Icon name={icon} className="text-[18px] text-primary" /> {title}
        </h2>
        {meta && <div className="font-mono text-code-sm text-on-surface-variant">{meta}</div>}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

export function IncidentHeader({ incident: i }) {
  return (
    <header className="flex flex-col gap-2 rounded border border-outline-variant bg-surface-container-low px-5 py-4">
      <div className="flex flex-wrap items-center gap-2 font-mono text-code-md">
        <span className="rounded bg-surface-container-highest px-1.5 py-0.5 text-primary">#{i.id.slice(-6)}</span>
        <span className="text-on-surface-variant">
          {utcStamp(i.startedAt)} ({relativeTime(i.startedAt)})
        </span>
      </div>
      <h1 className="text-headline-xl font-semibold">{incidentTitle(i)}</h1>
      <p className="text-body-lg text-on-surface-variant">{i.cause}</p>
      <div className="flex flex-wrap items-center gap-2 font-mono text-code-sm">
        {isManual(i) ? (
          <span className="inline-flex items-center gap-1 rounded border border-secondary/40 px-2 py-0.5 text-secondary">
            <Icon name="person" className="text-[14px]" /> Manual
          </span>
        ) : (
          <span className="rounded border border-error/40 bg-error-container/20 px-2 py-0.5 text-error">{i.alertName}</span>
        )}
        {i.status === 'RESOLVED' ? (
          <span className="inline-flex items-center gap-1 rounded border border-tertiary/30 bg-tertiary/10 px-2 py-0.5 text-tertiary">
            <Icon name="check_circle" className="text-[14px]" /> Recovered in {i.recoverySeconds} s
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning">
            <Icon name="warning" className="text-[14px]" /> Open
          </span>
        )}
        {i.githubIssueUrl && (
          <a
            href={i.githubIssueUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded border border-outline-variant bg-surface-container px-2 py-0.5 text-primary hover:underline"
          >
            <Icon name="bug_report" className="text-[14px]" /> GitHub issue #{i.githubIssueNumber}
          </a>
        )}
        {i.pod && (
          <span className="inline-flex items-center gap-1 rounded border border-outline-variant bg-surface-container px-2 py-0.5 text-on-surface-variant">
            <Icon name="dns" className="text-[14px]" /> Pod: {i.pod}
          </span>
        )}
      </div>
    </header>
  );
}

// Gemini's explanation (FR-53), stored a few seconds after the incident
// opens. Without it, the rule-based cause above is the whole story (FR-54).
// Kairo doesn't keep the pod's logs with the incident, so this points to the
// Logs screen, which shows the app's newest pod now
export function Explanation({ incident, logsUrl }) {
  return (
    <Section title="What happened" icon="psychology">
      <div className="flex flex-col gap-2">
      {incident.explanation ? (
        <>
          <p className="text-body-lg">{incident.explanation}</p>
          <p className="flex items-center gap-1 font-mono text-code-sm text-on-surface-variant">
            <Icon name="auto_awesome" className="text-[14px]" /> Explained by Gemini from the alert and the pod's last 50 log lines
          </p>
        </>
      ) : (
        <p className="text-body-md text-on-surface-variant">
          No explanation from Gemini. It explains incidents from the pod's logs a few seconds after they open; when it is off or busy,
          the cause above is Kairo's rule-based reading of the alert.
        </p>
      )}
      {logsUrl && (
        <Link to={logsUrl} className="inline-flex w-fit items-center gap-1 font-mono text-code-sm text-primary hover:underline">
          <Icon name="terminal" className="text-[14px]" /> The app's logs now →
        </Link>
      )}
      </div>
    </Section>
  );
}

export function MemoryChart({ incident }) {
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
    <Section title="Pod memory (MiB)" icon="monitoring" meta={`Limit: ${m.limitBytes / MiB} MiB`}>
      <div className="flex flex-col gap-2">
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
      </div>
    </Section>
  );
}

// alert fired, each action and its check, resolved: in time order, with T+s
function events(i) {
  const list = [
    isManual(i)
      ? { t: i.startedAt, title: 'Rollback asked for', text: i.cause, icon: 'person', tone: 'busy' }
      : { t: i.startedAt, title: 'Alert fired', text: i.cause, icon: 'warning', tone: 'bad' },
  ];
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
        text: `${a.reason ? `${a.reason.charAt(0).toUpperCase()}${a.reason.slice(1)}. ` : ''}Kairo stopped acting on the app and it needs attention.`,
        icon: 'help',
        tone: 'bad',
      });
    } else if (badge.label === 'Checking') {
      list.push({ t: null, title: 'Checking', text: 'Kairo is checking that the action took effect (up to 90 s).', icon: 'progress_activity', tone: 'busy', spin: true });
    }
  }
  // FR-55: the GitHub issue (mockup v2). Incidents from before P5e have the
  // number but not the time: their step goes after Kairo's last action
  // (issues are reported once it acted) and shows no time
  if (i.githubIssueNumber) {
    const lastAction = i.attempts.length ? Date.parse(i.attempts.at(-1).attemptedAt) : Date.parse(i.startedAt);
    list.push({
      t: i.githubIssueAt,
      after: i.githubIssueAt ? undefined : lastAction + 1,
      title: `GitHub issue #${i.githubIssueNumber}`,
      href: i.githubIssueUrl,
      text:
        i.githubIssueOpened === true
          ? "Kairo opened an issue on the app's repo."
          : i.githubIssueOpened === false
            ? "Kairo commented on the app's open issue."
            : "Kairo reported this incident on the app's issue.",
      icon: 'bug_report',
      tone: 'muted',
    });
  }
  if (i.resolvedAt) {
    list.push(
      isManual(i)
        ? { t: i.resolvedAt, title: 'Closed', text: "Kairo closed the incident when the rollback's check ended.", icon: 'check_circle', tone: 'ok' }
        : { t: i.resolvedAt, title: 'Alert resolved', text: 'Prometheus marked the alert resolved.', icon: 'check_circle', tone: 'ok' },
    );
  }
  const at = (e) => (e.t ? Date.parse(e.t) : (e.after ?? Infinity));
  return list.sort((a, b) => at(a) - at(b));
}

// "14 s", "6 min 16 s"
function since(start, iso) {
  const s = Math.round((Date.parse(iso) - start) / 1000);
  return s < 120 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function Timeline({ incident }) {
  const list = events(incident);
  const start = Date.parse(incident.startedAt);
  return (
    <Section title="Timeline" icon="timeline" meta={`${list.length} events`}>
      <ol className="relative ml-2.5 flex flex-col gap-4 border-l border-outline-variant pl-5">
        {list.map((e, n) => (
          <li key={n} className="relative">
            <span className={`absolute -left-[31px] top-0 grid size-5 place-items-center rounded-full bg-surface-container-high ${TONE_CLASS[e.tone]}`}>
              <Icon name={e.icon} spin={e.spin} className="text-[14px]" />
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 font-mono text-code-md">
              <span className={`${TONE_CLASS[e.tone]} uppercase`}>
                {e.t ? `${utcClock(e.t, true)} UTC · ` : ''}
                {e.href ? (
                  <a href={e.href} target="_blank" rel="noreferrer" className="hover:underline">
                    {e.title}
                  </a>
                ) : (
                  e.title
                )}
              </span>
              {e.t && <span className="shrink-0 text-on-surface-variant">T+{since(start, e.t)}</span>}
            </div>
            <p className="text-body-md">{e.text}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// every action with its trigger, dry-run flag, result, reason and check time (FR-52)
export function Attempts({ incident }) {
  const th = 'px-3 py-2 text-left font-mono text-code-sm uppercase tracking-wider text-on-surface-variant font-normal';
  return (
    <Section title="Attempts" icon="bolt">
      {incident.attempts.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">None recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-outline-variant [contain:paint]">
          <table className="w-full min-w-[440px] border-collapse">
            <thead className="border-b border-outline-variant bg-surface-container">
              <tr>
                <th className={th}>Action</th>
                <th className={th}>Result</th>
                <th className={th}>Reason</th>
                <th className={`${th} text-right`}>Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {incident.attempts.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2 font-mono text-code-md text-primary">
                    {actionText(a)}
                    {a.trigger === 'MANUAL' && <span className="text-on-surface-variant"> · manual</span>}
                    {a.dryRun && <span className="text-on-surface-variant"> · dry run</span>}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={attemptBadge(a)} />
                  </td>
                  <td className="px-3 py-2 text-body-md text-on-surface-variant">{a.reason ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-code-md">
                    {utcClock(a.attemptedAt, true)} UTC
                    {a.verifiedAt && <span className="text-tertiary"> ({duration(a.attemptedAt, a.verifiedAt)})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
