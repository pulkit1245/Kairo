import { DeploymentTable } from '../components/onboarding/DeploymentTable.jsx';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { Panel, PanelMessage } from '../components/common/Panel.jsx';
import { usePoll } from '../hooks/usePoll.js';
import { listDeployments } from '../services/api.js';
import { IN_PROGRESS_STATUSES } from '../types/enums.js';

// P0 placeholder for the Apps screen: the latest 20 pipeline runs.
// P1 turns this into the onboarding view, P2 into the Apps list (screen 06).
const POLL_MS = 5_000;

export function DeploymentsPage() {
  const { data, error, loading } = usePoll(listDeployments, POLL_MS);
  const running = data?.filter((d) => !d.finishedAt && IN_PROGRESS_STATUSES.includes(d.status)).length ?? 0;

  return (
    <>
      <PageHeader
        title="Apps"
        subtitle="Repos Kairo deploys and keeps healthy. For now: the latest pipeline runs."
        badge={
          running > 0 && (
            <span className="rounded border border-outline-variant px-2 py-0.5 font-mono text-code-md text-primary">
              {running} in progress
            </span>
          )
        }
      />
      <Panel title="Pipeline runs" meta={data && `latest ${data.length} · refreshes every 5 s`}>
        {loading && <PanelMessage>Loading…</PanelMessage>}
        {error && !data && <PanelMessage tone="bad">{error.message}</PanelMessage>}
        {data?.length === 0 && (
          <PanelMessage>
            No pipeline runs yet. Until the repo picker arrives in P2, start one with{' '}
            <code className="font-mono text-code-md">POST /api/deployments</code>.
          </PanelMessage>
        )}
        {data?.length > 0 && <DeploymentTable deployments={data} />}
      </Panel>
    </>
  );
}
