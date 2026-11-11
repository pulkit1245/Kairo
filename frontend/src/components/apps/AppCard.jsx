import { Link } from 'react-router';
import { relativeTime, shortSha } from '../common/format.js';
import { Icon } from '../common/Icon.jsx';
import { HEALTH, stackLabel, TONE_CLASS } from '../common/status.js';

// One app on the Apps list (Stitch 06): name, stack and public link; pipeline,
// health, live numbers and memory; the active release and the last incident.

const STEP = {
  CLONING: 'Cloning',
  DETECTING: 'Detecting',
  GENERATING: 'Generating',
  BUILDING: 'Building',
  DEPLOYING: 'Deploying',
};

export function AppCard({ app, now }) {
  const live = Boolean(app.release);
  const health = live ? (HEALTH[app.health] ?? HEALTH.HEALTHY) : null;
  const attention = app.health === 'NEEDS_ATTENTION' && live;
  const pipeline = pipelineText(app.pipeline, now);

  return (
    <article
      className={`rounded border bg-surface-container-low ${attention ? 'border-error/40' : 'border-outline-variant'}`}
      aria-label={app.slug}
    >
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
        {/* name, stack, link */}
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded border border-outline-variant bg-surface-container ${
              health ? TONE_CLASS[health.tone] : 'text-on-surface-variant'
            }`}
          >
            <Icon name={cardIcon(app, live)} spin={app.health === 'HEALING' && live} className="text-[22px]" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/apps/${app.slug}`} className="font-mono text-headline-md font-semibold hover:underline">
                {app.slug}
              </Link>
              {app.stack && (
                <span className="rounded border border-outline-variant bg-surface-container-high px-2 py-0.5 font-mono text-code-sm text-on-surface-variant">
                  {stackLabel(app.stack)}
                </span>
              )}
            </div>
            <PublicLink app={app} live={live} />
          </div>
        </div>

        {/* the four numbers */}
        <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-3 rounded border border-outline-variant bg-surface-container px-4 py-3 font-mono sm:grid-cols-4 lg:w-[540px]">
          <Stat label="Pipeline" value={pipeline.value} tone={pipeline.tone} dot sub={pipeline.sub} />
          {health ? (
            <Stat
              label="Health"
              icon={health.icon}
              value={health.label}
              tone={health.tone}
              sub={healthSub(app)}
              subTone={attention ? 'bad' : app.health === 'HEALING' ? 'busy' : 'muted'}
            />
          ) : (
            <Stat label="Health" value="Not running" tone="muted" sub="nothing deployed" />
          )}
          <Stat label="Telemetry" value={live ? rps(app.now) : '—'} sub={live ? cpu(app.now) : ''} />
          <Stat
            label="Allocation"
            value={live ? memory(app.now) : '—'}
            sub={live ? replicas(app.now) : ''}
            subTone={live && app.now?.replicasReady === app.now?.replicasDesired && app.now?.replicasReady > 0 ? 'ok' : 'muted'}
          />
        </dl>

        {/* actions */}
        <div className="flex shrink-0 gap-2 lg:flex-col xl:flex-row">
          <Link to={`/apps/${app.slug}`} className={button}>
            <Icon name="open_in_new" className="text-[16px]" /> Open
          </Link>
          {live ? (
            <Link to={`/apps/${app.slug}#logs`} className={button}>
              <Icon name="terminal" className="text-[16px]" /> Logs
            </Link>
          ) : (
            app.pipeline && (
              <Link to={`/deployments/${app.pipeline.id}`} className={button}>
                <Icon name="receipt_long" className="text-[16px]" /> Run
              </Link>
            )
          )}
        </div>
      </div>

      {/* release and last incident */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-outline-variant px-4 py-2.5 font-mono text-code-sm">
        {live ? (
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="uppercase tracking-wider text-on-surface-variant">Active release</span>
            <code className="rounded border border-outline-variant px-1.5 py-0.5 text-primary" title={app.release.commitSha}>
              SHA {shortSha(app.release.commitSha)}
            </code>
            {app.release.commitMessage && <span className="truncate text-on-surface">{app.release.commitMessage}</span>}
            {app.release.source === 'TEST' && <span className="text-on-surface-variant">(Break It)</span>}
          </span>
        ) : (
          <span className="text-on-surface-variant">No running release</span>
        )}
        <LastIncident incident={app.lastIncident} now={now} />
      </div>
    </article>
  );
}

const button =
  'inline-flex items-center justify-center gap-1.5 rounded border border-outline-variant bg-surface-container px-3 py-1.5 font-mono text-code-md text-on-surface hover:bg-surface-container-high';

function Stat({ label, value, sub, icon, dot, tone = null, subTone = 'muted' }) {
  return (
    <div className="min-w-0">
      <dt className="text-code-sm uppercase tracking-wider text-on-surface-variant">{label}</dt>
      <dd className={`mt-0.5 flex items-center gap-1.5 text-code-md ${tone ? TONE_CLASS[tone] : 'text-on-surface'}`}>
        {dot && <span className="size-2 shrink-0 rounded-full bg-current" />}
        {icon && <Icon name={icon} className="text-[16px]" />}
        <span className="truncate">{value}</span>
      </dd>
      {sub && <dd className={`mt-0.5 text-code-sm ${TONE_CLASS[subTone]}`}>{sub}</dd>}
    </div>
  );
}

// FR-40: the public link, or what the tunnel is doing
function PublicLink({ app, live }) {
  if (app.publicUrl) {
    return (
      <a
        href={app.publicUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-w-0 items-center gap-1 break-all font-mono text-code-md text-primary hover:underline"
      >
        {app.publicUrl} <Icon name="open_in_new" className="shrink-0 text-[14px]" />
      </a>
    );
  }
  if (!live) return <span className="font-mono text-code-sm text-on-surface-variant">{app.repoFullName}</span>;
  const text =
    app.tunnel === 'restarting'
      ? 'Public link dropped; restarting it…'
      : app.tunnel === 'starting'
        ? 'Starting the public link…'
        : 'No public link';
  return <span className="font-mono text-code-sm text-on-surface-variant">{text}</span>;
}

function LastIncident({ incident, now }) {
  if (!incident) return <span className="ml-auto text-on-surface-variant">No incidents</span>;
  const open = incident.status === 'OPEN';
  return (
    <span className="ml-auto flex items-center gap-2">
      <span className="text-on-surface-variant">Last incident:</span>
      {open ? (
        <span className="text-warning">{incident.cause}</span>
      ) : (
        <span className="text-on-surface">
          {relativeTime(incident.startedAt, now)}
          {incident.recoverySeconds !== null && ` (recovered in ${incident.recoverySeconds} s)`}
        </span>
      )}
      <span className={`size-2 rounded-full ${open ? 'bg-warning' : 'bg-tertiary'}`} />
    </span>
  );
}

function cardIcon(app, live) {
  if (!live) return app.pipeline?.status === 'FAILED' ? 'error' : 'deployed_code';
  if (app.health === 'NEEDS_ATTENTION') return 'warning';
  if (app.health === 'HEALING') return 'sync';
  return 'deployed_code';
}

function pipelineText(run, now) {
  if (!run) return { value: 'No run', tone: 'muted', sub: '' };
  if (run.status === 'RUNNING') return { value: 'Passed', tone: 'ok', sub: 'Onboarded' };
  if (run.status === 'FAILED') {
    const step = STEP[run.failedStep];
    return { value: 'Failed', tone: 'bad', sub: step ? `at ${step}` : relativeTime(run.finishedAt, now) };
  }
  return { value: `${STEP[run.status] ?? run.status}…`, tone: 'busy', sub: `started ${relativeTime(run.startedAt, now)}` };
}

function healthSub(app) {
  if (app.health === 'NEEDS_ATTENTION') return app.attentionReason ?? 'Kairo stopped acting on it';
  if (app.health === 'HEALING') return 'Kairo is acting on it';
  return app.autoHeal ? 'auto-heal on' : 'auto-heal off';
}

// numbers: null means Prometheus had nothing (or isn't answering)
function rps(now) {
  if (now?.rps == null) return '— rps';
  const v = now.rps;
  return `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString()} rps`;
}

const cpu = (now) => (now?.cpuShare == null ? 'CPU —' : `CPU ${Math.round(now.cpuShare * 100)}%`);

function memory(now) {
  const limit = Math.round((now?.memoryLimitBytes ?? 0) / 2 ** 20);
  return now?.memoryBytes == null ? `— / ${limit} MiB` : `${Math.round(now.memoryBytes / 2 ** 20)} / ${limit} MiB`;
}

function replicas(now) {
  if (now?.replicasDesired == null) return '— replicas';
  return `${now.replicasReady ?? 0}/${now.replicasDesired} replicas`;
}
