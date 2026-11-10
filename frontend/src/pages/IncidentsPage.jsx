import { PageHeader } from '../components/common/PageHeader.jsx';
import { Panel, PanelMessage } from '../components/common/Panel.jsx';
import { IncidentTable } from '../components/operations/IncidentTable.jsx';
import { RecoveryChart } from '../components/operations/RecoveryChart.jsx';
import { usePoll } from '../hooks/usePoll.js';
import { listIncidents } from '../services/api.js';

// Every app's incidents in one feed, newest first, refreshing every 5 s.
// In P3 they move into each app's dashboard (screen 07) and this page goes away.
const POLL_MS = 5_000;

export function IncidentsPage() {
  const { data, error, loading } = usePoll(listIncidents, POLL_MS);
  const open = data?.filter((i) => i.status === 'OPEN').length ?? 0;

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle="Alerts Kairo received and what it did about them."
        badge={
          data && (
            <span className="rounded border border-outline-variant px-2 py-0.5 font-mono text-code-md">
              <span className={open > 0 ? 'text-warning' : 'text-tertiary'}>{open} open</span>
            </span>
          )
        }
      />
      {loading && <PanelMessage>Loading…</PanelMessage>}
      {error && !data && <PanelMessage tone="bad">{error.message}</PanelMessage>}
      {data && (
        <div className="flex flex-col gap-6">
          <Panel title="Recovery time" meta="seconds from alert to resolved">
            <div className="p-4">
              <RecoveryChart incidents={data} />
            </div>
          </Panel>
          <Panel title="Incidents" meta={`latest ${data.length} · refreshes every 5 s`}>
            {data.length === 0 ? (
              <PanelMessage>No incidents yet. Alertmanager sends them to POST /api/alerts.</PanelMessage>
            ) : (
              <IncidentTable incidents={data} />
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
