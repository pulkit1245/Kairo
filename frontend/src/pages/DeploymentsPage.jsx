import { Link } from 'react-router';
import { Icon } from '../components/common/Icon.jsx';
import { DeploymentTable } from '../components/onboarding/DeploymentTable.jsx';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { Panel, PanelMessage } from '../components/common/Panel.jsx';
import { usePoll } from '../hooks/usePoll.js';
import { listDeployments } from '../services/api.js';
import { IN_PROGRESS_STATUSES } from '../types/enums.js';

// P0 placeholder for the Apps screen: the latest 20 pipeline runs.
// The Apps list (screen 06) replaces it once apps have their own page (P2c, P3).
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
      <div className="mb-6">
        <Link
          to="/apps/new"
          className="inline-flex items-center gap-2 rounded bg-primary-container px-4 py-2 text-body-lg font-medium text-on-primary-container hover:brightness-110"
        >
          <Icon name="add" className="text-[18px]" /> Add a repo
        </Link>
      </div>
      <Panel title="Pipeline runs" meta={data && `latest ${data.length} · refreshes every 5 s`}>
        {loading && <PanelMessage>Loading…</PanelMessage>}
        {error && !data && <PanelMessage tone="bad">{error.message}</PanelMessage>}
        {data?.length === 0 && (
          <PanelMessage>
            No pipeline runs yet. Add a repo to start one.
          </PanelMessage>
        )}
        {data?.length > 0 && <DeploymentTable deployments={data} />}
      </Panel>
    </>
  );
}
