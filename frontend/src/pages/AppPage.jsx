import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ReleaseTable } from '../components/app/ReleaseTable.jsx';
import { relativeTime, shortSha } from '../components/common/format.js';
import { Icon } from '../components/common/Icon.jsx';
import { Panel, PanelMessage } from '../components/common/Panel.jsx';
import { runStatus, stackLabel, TONE_CLASS } from '../components/common/status.js';
import { StatusBadge } from '../components/common/StatusBadge.jsx';
import { usePoll } from '../hooks/usePoll.js';
import { getApp } from '../services/api.js';

// The app page (Stitch 07). P2c builds the header and the release list; P3
// fills the empty slots with live KPIs, charts, incidents, logs and the test
// panel. Polled, because rollouts happen in the background (GHCR watcher).
const POLL_MS = 5000;

const HEALTH = {
  HEALTHY: { label: 'Healthy', icon: 'check_circle', tone: 'ok', box: 'border-tertiary/30 bg-tertiary/10' },
  HEALING: { label: 'Healing', icon: 'healing', tone: 'busy', box: 'border-primary/30 bg-primary/10' },
  NEEDS_ATTENTION: { label: 'Needs attention', icon: 'warning', tone: 'bad', box: 'border-error/40 bg-error-container/20' },
};

const PR_LABEL = { OPEN: 'Open', MERGED: 'Merged', CLOSED: 'Closed', FAILED: "Couldn't open" };

export function AppPage() {
  const { slug } = useParams();
  const { data: app, error, loading } = usePoll(() => getApp(slug), POLL_MS, [slug]);
  const now = useNow(app?.release && !app.release.healthyAt);

  if (loading) return <PanelMessage>Loading…</PanelMessage>;
  if (!app) return <PanelMessage tone="bad">{error?.message ?? 'Not found'}</PanelMessage>;

  return (
    <div className="flex flex-col gap-5">
      <Link to="/" className="inline-flex w-fit items-center gap-1 text-body-md text-on-surface-variant hover:text-on-surface">
        <Icon name="arrow_back" className="text-[16px]" /> Apps
      </Link>
      <AppHeader app={app} now={now} />
      <P3Slots />
      <Panel title="Releases" meta={`${app.releases.length} shown · last 3 images kept`}>
        {app.releases.length ? (
          <ReleaseTable releases={app.releases} now={now} />
        ) : (
          <PanelMessage>No releases yet. The first one is the preview.</PanelMessage>
        )}
      </Panel>
    </div>
  );
}

function AppHeader({ app, now }) {
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
              · {r.source === 'GHCR' ? 'GHCR' : 'preview'} · {relativeTime(r.deployedAt, now)}
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
        {app.publicUrl && (
          <a href={app.publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            {app.publicUrl} <Icon name="open_in_new" className="text-[14px]" />
          </a>
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
        <span className="text-outline">
          Auto-heal: <span className={app.autoHeal ? 'font-bold text-tertiary' : 'font-bold text-on-surface-variant'}>{app.autoHeal ? 'ON' : 'OFF'}</span>
        </span>
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

// where P3's live parts go (Stitch 07): KPIs and charts, incidents and logs, test panel
function P3Slots() {
  const slot = 'grid place-items-center rounded border border-dashed border-outline-variant px-4 py-6 text-center font-mono text-code-sm text-on-surface-variant';
  return (
    <div className="grid gap-3 md:grid-cols-3" aria-label="Coming in P3">
      <div className={slot}>Live KPIs and charts · P3</div>
      <div className={slot}>Incidents and app logs · P3</div>
      <div className={slot}>Test panel · P3</div>
    </div>
  );
}

// ticks every second while a grace window counts down
function useNow(ticking) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}
