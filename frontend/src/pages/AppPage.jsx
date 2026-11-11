import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { AppIncidents } from '../components/app/AppIncidents.jsx';
import { AttentionBanner } from '../components/app/AttentionBanner.jsx';
import { AutoHealToggle } from '../components/app/AutoHealToggle.jsx';
import { DeleteAppDialog } from '../components/app/DeleteAppDialog.jsx';
import { IncidentDrawer } from '../components/app/IncidentDrawer.jsx';
import { KpiRow } from '../components/app/KpiRow.jsx';
import { LogsPanel } from '../components/app/LogsPanel.jsx';
import { MetricCharts } from '../components/app/MetricCharts.jsx';
import { ReleaseTable } from '../components/app/ReleaseTable.jsx';
import { TestPanel } from '../components/app/TestPanel.jsx';
import { relativeTime, shortSha } from '../components/common/format.js';
import { Icon } from '../components/common/Icon.jsx';
import { Panel, PanelMessage } from '../components/common/Panel.jsx';
import { HEALTH, runStatus, stackLabel, TONE_CLASS } from '../components/common/status.js';
import { StatusBadge } from '../components/common/StatusBadge.jsx';
import { usePoll } from '../hooks/usePoll.js';
import { getApp, getAppMetrics } from '../services/api.js';

// The app page (Stitch 07, 10): header, needs-attention banner, live KPIs and
// charts, incidents and logs, releases and the test panel. Everything polls
// every 5 s (FR-56, FR-58): healing and rollouts happen in the background.
const POLL_MS = 5000;

const PR_LABEL = { OPEN: 'Open', MERGED: 'Merged', CLOSED: 'Closed', FAILED: "Couldn't open" };

export function AppPage() {
  const { slug } = useParams();
  const { data: app, error, loading } = usePoll(() => getApp(slug), POLL_MS, [slug]);
  const metrics = usePoll(() => getAppMetrics(slug), POLL_MS, [slug]);
  const [openIncident, setOpenIncident] = useState(null);
  const closeIncident = useCallback(() => setOpenIncident(null), []);
  const [deleting, setDeleting] = useState(false);
  const closeDelete = useCallback(() => setDeleting(false), []);
  // ticks every second during a grace window or Send Traffic, for their countdowns
  const now = useNow((app?.release && !app.release.healthyAt) || app?.traffic?.running);

  // the Apps list's Logs button links to #logs: scroll there once the page is drawn
  const { hash } = useLocation();
  const loaded = Boolean(app);
  useEffect(() => {
    if (loaded && hash === '#logs') document.getElementById('logs')?.scrollIntoView({ block: 'start' });
  }, [loaded, hash]);

  if (loading) return <PanelMessage>Loading…</PanelMessage>;
  if (!app) return <PanelMessage tone="bad">{error?.message ?? 'Not found'}</PanelMessage>;

  return (
    <div className="flex flex-col gap-5">
      <Link to="/" className="inline-flex w-fit items-center gap-1 text-body-md text-on-surface-variant hover:text-on-surface">
        <Icon name="arrow_back" className="text-[16px]" /> Apps
      </Link>
      <AppHeader app={app} now={now} onDelete={() => setDeleting(true)} />
      <AttentionBanner app={app} />
      <KpiRow metrics={metrics.data} app={app} />
      <MetricCharts metrics={metrics.data} incidents={app.incidents} error={metrics.error} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <AppIncidents incidents={app.incidents} onOpen={setOpenIncident} />
        <LogsPanel slug={app.slug} />
      </div>
      <Panel id="releases" title="Releases" meta={`${app.releases.length} shown · last 3 images kept`}>
        {app.releases.length ? (
          <ReleaseTable slug={app.slug} releases={app.releases} now={now} />
        ) : (
          <PanelMessage>No releases yet. The first one is the preview.</PanelMessage>
        )}
      </Panel>
      <TestPanel app={app} now={now} />
      {openIncident && <IncidentDrawer id={openIncident} onClose={closeIncident} />}
      {deleting && <DeleteAppDialog app={app} onClose={closeDelete} />}
    </div>
  );
}

function AppHeader({ app, now, onDelete }) {
  const health = HEALTH[app.health] ?? HEALTH.HEALTHY;
  const r = app.release;
  return (
    <header className="flex flex-col gap-3 rounded border border-outline-variant bg-surface-container-low px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Icon name="deployed_code" className="text-[22px] text-primary" />
        <h1 className="font-mono text-headline-xl font-semibold">{app.slug}</h1>
        {app.stack && (
          <span className="rounded border border-outline-variant bg-surface-container-high px-2 py-0.5 font-mono text-code-sm text-on-surface-variant">
            {stackLabel(app.stack)}
          </span>
        )}
        <span className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-0.5 font-mono text-code-sm font-semibold ${health.box} ${TONE_CLASS[health.tone]}`}>
          <Icon name={health.icon} className="text-[15px]" /> {health.label}
        </span>
        {r ? (
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-body-md text-on-surface-variant">
            <span className="text-outline">Active:</span>
            <code className="rounded border border-outline-variant bg-surface-container px-1.5 py-0.5 font-mono text-code-sm text-primary" title={r.commitSha}>
              {shortSha(r.commitSha)}
            </code>
            {r.commitMessage && <span className="text-on-surface">{r.commitMessage}</span>}
            <span className="text-outline">
              · {r.source === 'GHCR' ? 'GHCR' : r.source === 'TEST' ? 'Break It' : 'preview'} · {relativeTime(r.deployedAt, now)}
            </span>
          </span>
        ) : (
          <span className="text-body-md text-on-surface-variant">No running release</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-code-sm">
        <a href={app.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          {app.repoFullName} <Icon name="open_in_new" className="text-[14px]" />
        </a>
        {app.publicUrl ? (
          <a href={app.publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">
            {app.publicUrl} <Icon name="open_in_new" className="text-[14px]" />
          </a>
        ) : (
          app.tunnel && (
            <span className="text-on-surface-variant">
              {app.tunnel === 'restarting' ? 'Public link dropped; restarting it…' : 'Starting the public link…'}
            </span>
          )
        )}
        {app.pr.number && app.pr.url ? (
          <a href={app.pr.url} target="_blank" rel="noreferrer" className="rounded border border-outline-variant bg-surface-container px-2 py-0.5 text-secondary hover:underline">
            PR #{app.pr.number} {PR_LABEL[app.pr.state] ?? ''}
          </a>
        ) : (
          <span className="rounded border border-outline-variant px-2 py-0.5 text-on-surface-variant">
            {app.installed ? 'No PR yet' : 'No PR (URL shortcut)'}
          </span>
        )}
        {app.pipeline && (
          <Link to={`/deployments/${app.pipeline.id}`} className="inline-flex items-center gap-1.5 hover:underline">
            <span className="text-outline">Last run:</span>
            <StatusBadge status={runStatus(app.pipeline)} className="text-code-sm" />
          </Link>
        )}
        <AutoHealToggle app={app} />
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto inline-flex items-center gap-1.5 rounded border border-error/40 px-2.5 py-1 font-mono text-code-sm text-error hover:bg-error-container/20"
        >
          <Icon name="delete" className="text-[15px]" /> Delete app
        </button>
      </div>

      <p className="flex items-center gap-1.5 text-body-sm text-on-surface-variant">
        <Icon name={app.watchingGhcr ? 'sync' : 'schedule'} className="text-[16px]" />
        {app.watchingGhcr
          ? `Watching GHCR: every push to ${app.defaultBranch ?? 'the default branch'} is built by GitHub Actions and rolled out here, then watched for 60 s.`
          : app.installed
            ? 'Kairo starts rolling out images from GHCR once the setup PR is merged.'
            : 'Started from a pasted URL: no PR, so no GHCR rollouts.'}
      </p>
    </header>
  );
}

// ticks every second while `ticking`, for countdowns
function useNow(ticking) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}
