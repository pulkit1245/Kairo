import { Link, useLocation } from 'react-router';
import { AppCard } from '../components/apps/AppCard.jsx';
import { Icon } from '../components/common/Icon.jsx';
import { PanelMessage } from '../components/common/Panel.jsx';
import { usePoll } from '../hooks/usePoll.js';
import { listApps } from '../services/api.js';

// The home page (Stitch 06): one card per live app. Deleted apps are hidden
// (FR-65); an app whose onboarding failed stays, with the step it stopped at,
// so its run can still be opened. Refreshes every 5 s, like the app page.
const POLL_MS = 5000;

export function AppsPage() {
  const { data, error, loading } = usePoll(listApps, POLL_MS);
  // set by the delete dialog (FR-65)
  const deleted = useLocation().state?.deleted;
  const now = Date.now();
  const count = data && `${data.running} of ${data.maxRunning} running`;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-headline-xl font-semibold">Apps</h1>
            {count && (
              <span className="inline-flex items-center gap-1.5 rounded border border-outline-variant px-2 py-0.5 font-mono text-code-md text-on-surface">
                <span className="size-2 rounded-full bg-tertiary" /> {count}
              </span>
            )}
          </div>
          <p className="mt-1 text-body-lg text-on-surface-variant">Repos Kairo deploys and keeps healthy.</p>
        </div>
        <Link
          to="/apps/new"
          className="inline-flex items-center gap-2 rounded bg-primary-container px-4 py-2 text-body-lg font-medium text-on-primary-container hover:brightness-110"
        >
          <Icon name="add" className="text-[18px]" /> Add repo
        </Link>
      </div>

      {deleted && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded border border-tertiary/30 bg-tertiary/10 px-4 py-2 text-body-md">
          <Icon name="check_circle" className="text-[18px] text-tertiary" />
          Deleted {deleted}. Its namespace is being removed; its history and GitHub repo stay.
        </p>
      )}

      {loading && <PanelMessage>Loading…</PanelMessage>}
      {error && !data && <PanelMessage tone="bad">{error.message}</PanelMessage>}
      {data?.apps.length === 0 && (
        <div className="rounded border border-outline-variant bg-surface-container-low">
          <PanelMessage>No apps yet. Add a repo and Kairo deploys it.</PanelMessage>
        </div>
      )}
      {data?.apps.length > 0 && (
        <div className="flex flex-col gap-4">
          {data.apps.map((app) => (
            <AppCard key={app.id} app={app} now={now} />
          ))}
        </div>
      )}
      {data?.apps.length > 0 && (
        <p className="mt-6 border-t border-outline-variant pt-4 text-body-md text-on-surface-variant">
          {count} apps{error && ` · last refresh failed: ${error.message}`}
        </p>
      )}
    </>
  );
}
