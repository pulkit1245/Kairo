import { useCallback, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { AppIncidents } from '../../components/app/AppIncidents.jsx';
import { IncidentDrawer } from '../../components/app/IncidentDrawer.jsx';
import { KpiRow } from '../../components/app/KpiRow.jsx';
import { MetricCharts } from '../../components/app/MetricCharts.jsx';
import { releaseHealth } from '../../components/app/ReleaseTable.jsx';
import { screenUrl } from '../../components/app/screens.js';
import { relativeTime, shortSha } from '../../components/common/format.js';
import { Icon } from '../../components/common/Icon.jsx';
import { TONE_CLASS } from '../../components/common/status.js';
import { usePoll } from '../../hooks/usePoll.js';
import { getAppIncidents, getAppMetrics } from '../../services/api.js';

// The Overview (mockup v2): the six live numbers (FR-56), the traffic chart,
// the latest 3 incidents and the active release. Polls the metrics and those
// 3 incidents every 5 s; the header above polls the app's own facts.
const POLL_MS = 5000;
const SOURCE = { GHCR: 'GHCR', PREVIEW: 'Preview', TEST: 'Break It' };

export function OverviewScreen() {
  const { app, now } = useOutletContext();
  const metrics = usePoll(() => getAppMetrics(app.slug), POLL_MS, [app.slug], `metrics:${app.slug}`);
  const latest = usePoll(() => getAppIncidents(app.slug, { limit: 3 }), POLL_MS, [app.slug], `incidents3:${app.slug}`);
  const [openIncident, setOpenIncident] = useState(null);
  const closeIncident = useCallback(() => setOpenIncident(null), []);

  return (
    <>
      <KpiRow metrics={metrics.data} app={app} />
      <MetricCharts metrics={metrics.data} error={metrics.error} charts={['traffic']} height={180} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <AppIncidents
          title="Latest incidents"
          filters={false}
          loading={latest.loading}
          incidents={latest.data?.incidents ?? []}
          onOpen={setOpenIncident}
          footer={
            app.incidentCount > 0 && (
              <MoreLink to={screenUrl(app.slug, 'incidents')}>
                View all {app.incidentCount} incident{app.incidentCount === 1 ? '' : 's'} →
              </MoreLink>
            )
          }
        />
        <ActiveRelease app={app} now={now} />
      </div>
      {openIncident && <IncidentDrawer id={openIncident} onClose={closeIncident} />}
    </>
  );
}

function MoreLink({ to, children }) {
  return (
    <Link to={to} className="mt-auto border-t border-outline-variant px-4 py-2.5 font-mono text-code-sm text-primary hover:underline">
      {children}
    </Link>
  );
}

// the running release, its health (FR-72) and what it can roll back to (FR-61)
function ActiveRelease({ app, now }) {
  const r = app.release;
  const h = r ? releaseHealth(r, now) : null;
  const n = app.rollbackTargets ?? 0;
  return (
    <section className="flex min-w-0 flex-col rounded border border-outline-variant bg-surface-container-low">
      <header className="flex items-center gap-2 border-b border-outline-variant px-4 py-3">
        <h2 className="flex items-center gap-2 font-mono text-code-md uppercase tracking-wider text-on-surface-variant">
          <Icon name="history" className="text-[18px] text-primary" /> Active release
        </h2>
      </header>
      {r ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <code className="rounded border border-primary/50 px-1.5 py-0.5 font-mono text-code-md text-primary" title={r.commitSha}>
              {shortSha(r.commitSha)}
            </code>
            <span className="min-w-0 break-words text-body-lg">{r.commitMessage ?? '—'}</span>
          </div>
          <dl className="grid grid-cols-2 gap-3 font-mono text-code-sm">
            <Fact label="Image from">{SOURCE[r.source] ?? r.source}</Fact>
            <Fact label="Health">
              <span className={`inline-flex items-center gap-1 ${TONE_CLASS[h.tone]}`}>
                <Icon name={h.icon} className="text-[14px]" /> {h.label}
              </span>
            </Fact>
            <Fact label="Deployed">{relativeTime(r.deployedAt, now)}</Fact>
            <Fact label="Can roll back to">{n === 0 ? 'none' : `${n} release${n === 1 ? '' : 's'}`}</Fact>
          </dl>
          <p className="flex items-start gap-1.5 text-body-sm text-on-surface-variant">
            <Icon name={app.watchingGhcr ? 'sync' : 'schedule'} className="text-[16px]" />
            {app.watchingGhcr
              ? `Watching GHCR: every push to ${app.defaultBranch ?? 'the default branch'} is built by GitHub Actions and rolled out here, then watched for 60 s.`
              : app.installed
                ? 'Kairo starts rolling out images from GHCR once the setup PR is merged.'
                : 'Started from a pasted URL: no PR, so no GHCR rollouts.'}
          </p>
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-body-md text-on-surface-variant">Nothing deployed yet.</p>
      )}
      <MoreLink to={screenUrl(app.slug, 'releases')}>View all releases →</MoreLink>
    </section>
  );
}

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="uppercase tracking-wider text-on-surface-variant">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
