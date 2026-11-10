import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { duration, repoName, shortSha } from '../components/common/format.js';
import { Icon } from '../components/common/Icon.jsx';
import { PanelMessage } from '../components/common/Panel.jsx';
import { runStatus, stackLabel } from '../components/common/status.js';
import { StatusBadge } from '../components/common/StatusBadge.jsx';
import { FailurePanel } from '../components/onboarding/FailurePanel.jsx';
import { FilesViewer } from '../components/onboarding/FilesViewer.jsx';
import { PreviewPanel } from '../components/onboarding/PreviewPanel.jsx';
import { Stepper } from '../components/onboarding/Stepper.jsx';
import { usePoll } from '../hooks/usePoll.js';
import { createDeployment, getDeployment, onboardRepo } from '../services/api.js';

// FR-8: poll every 3 s while the run is going, stop once it has finished
const POLL_MS = 3000;

// The onboarding view (Stitch screens 04 and 05) for one pipeline run.
export function DeploymentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: run, error, loading } = usePoll(
    () => getDeployment(id),
    (latest) => (latest && latest.finishedAt ? null : POLL_MS),
    [id],
  );
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(null);

  async function retry() {
    setRetrying(true);
    setRetryError(null);
    try {
      // the same way the run was started: from the picker, or the URL shortcut
      const next = run.installed ? await onboardRepo(run.repoFullName) : await createDeployment(run.repoUrl);
      navigate(`/deployments/${next.id}`);
    } catch (err) {
      setRetryError(err.message);
    } finally {
      setRetrying(false);
    }
  }

  if (loading) return <PanelMessage>Loading…</PanelMessage>;
  if (!run) return <PanelMessage tone="bad">{error?.message ?? 'Not found'}</PanelMessage>;

  const repoHref = run.repoUrl.replace(/\.git$/, '');

  return (
    <div className="flex flex-col gap-5">
      <Link to="/" className="inline-flex w-fit items-center gap-1 text-body-md text-on-surface-variant hover:text-on-surface">
        <Icon name="arrow_back" className="text-[16px]" /> Apps
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-headline-xl font-semibold">{run.appName}</h1>
            {run.stack && (
              <span className="rounded border border-outline-variant px-2 py-0.5 font-mono text-code-md text-on-surface-variant">
                {stackLabel(run.stack)}
              </span>
            )}
            <span className="rounded border border-outline-variant px-2 py-0.5">
              <StatusBadge status={runStatus(run)} />
            </span>
          </div>
          <p className="mt-1 text-body-lg text-on-surface-variant">
            {run.finishedAt ? 'Set up' : 'Setting up'} {repoName(run.repoUrl)}
            {run.commitSha && <> at <span className="font-mono text-secondary">{shortSha(run.commitSha)}</span></>}
            {run.finishedAt && <> · took {duration(run.startedAt, run.finishedAt)}</>}
          </p>
        </div>
        <a
          href={repoHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded border border-outline-variant px-3 py-2 font-mono text-code-md text-primary hover:bg-surface-container"
        >
          {repoName(run.repoUrl)}
          <Icon name="open_in_new" className="text-[16px]" />
        </a>
      </header>

      {error && (
        <p role="status" className="text-body-md text-warning">
          Couldn't refresh: {error.message}. Showing the last known state.
        </p>
      )}

      <Stepper run={run} />

      {run.status === 'FAILED' && <FailurePanel run={run} onRetry={retry} retrying={retrying} />}
      {retryError && (
        <p role="alert" className="text-body-md text-error">
          {retryError}
        </p>
      )}
      {run.status === 'RUNNING' && <PreviewPanel appName={run.appName} />}

      {run.configs?.length > 0 ? (
        <FilesViewer files={run.configs} />
      ) : (
        !run.finishedAt && <PanelMessage>Files appear once the GENERATING step is done.</PanelMessage>
      )}
    </div>
  );
}
