import { Link, Navigate, useParams } from 'react-router';
import { Attempts, Explanation, IncidentHeader, MemoryChart, Timeline } from '../../components/app/IncidentDetails.jsx';
import { incidentUrl, screenUrl } from '../../components/app/screens.js';
import { Icon } from '../../components/common/Icon.jsx';
import { PanelMessage } from '../../components/common/Panel.jsx';
import { isManual } from '../../components/app/incident.text.js';
import { usePoll } from '../../hooks/usePoll.js';
import { getIncident } from '../../services/api.js';
import { NotFoundPage } from '../NotFoundPage.jsx';

// One incident as its own page (P5d, mockup v2; it was a drawer): a
// breadcrumb, Newer/Older within the app, the header, what happened, the
// pods' memory, the timeline and the attempts. GitHub issue comments link
// here. It polls the incident every 5 s until it is settled (resolved, and no
// action still being checked), then stops.
const POLL_MS = 5000;
const settled = (i) => i && i.status === 'RESOLVED' && i.attempts.every((a) => a.result !== 'APPLIED');

// drawn fresh for each incident: Newer/Older never show the last one's data
export function IncidentPageRoute() {
  const { slug, id } = useParams();
  return <IncidentPage key={`${slug}/${id}`} />;
}

function IncidentPage() {
  const { slug, id } = useParams();
  const { data: incident, error, loading } = usePoll(() => getIncident(id), (i) => (settled(i) ? null : POLL_MS), [id], `incident:${id}`);

  if (loading) return <PanelMessage>Loading…</PanelMessage>;
  if (!incident) return error?.status === 404 ? <NotFoundPage /> : <PanelMessage tone="bad">{error?.message ?? 'Not found'}</PanelMessage>;
  // an incident opened under another app's address goes to its own
  if (incident.appName !== slug) return <Navigate replace to={incidentUrl(incident.appName, incident.id)} />;

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-wrap items-center gap-2 text-body-md text-on-surface-variant" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-on-surface">
          Apps
        </Link>
        <Icon name="chevron_right" className="text-[16px]" />
        <Link to={screenUrl(slug)} className="font-mono hover:text-on-surface">
          {slug}
        </Link>
        <Icon name="chevron_right" className="text-[16px]" />
        <Link to={screenUrl(slug, 'incidents')} className="hover:text-on-surface">
          Incidents
        </Link>
        <Icon name="chevron_right" className="text-[16px]" />
        <span className="font-mono text-on-surface" aria-current="page">
          #{incident.id.slice(-6)}
        </span>
        <span className="ml-auto flex gap-2">
          <Step to={incident.newerId && incidentUrl(slug, incident.newerId)} icon="chevron_left" label="Newer" />
          <Step to={incident.olderId && incidentUrl(slug, incident.olderId)} icon="chevron_right" label="Older" after />
        </span>
      </nav>

      <IncidentHeader incident={incident} />
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          {!isManual(incident) && <Explanation incident={incident} logsUrl={screenUrl(slug, 'logs')} />}
          <MemoryChart incident={incident} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Timeline incident={incident} />
          <Attempts incident={incident} />
        </div>
      </div>
    </div>
  );
}

// Newer / Older: a link, or a greyed label at either end of the list
function Step({ to, icon, label, after = false }) {
  const inner = after ? (
    <>
      {label} <Icon name={icon} className="text-[16px]" />
    </>
  ) : (
    <>
      <Icon name={icon} className="text-[16px]" /> {label}
    </>
  );
  const box = 'inline-flex items-center gap-1 rounded border border-outline-variant px-2.5 py-1 font-mono text-code-sm';
  return to ? (
    <Link to={to} className={`${box} bg-surface-container hover:bg-surface-container-high`}>
      {inner}
    </Link>
  ) : (
    <span className={`${box} cursor-default text-outline`} aria-disabled="true">
      {inner}
    </span>
  );
}
