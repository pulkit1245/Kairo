import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { relativeTime } from '../components/common/format.js';
import { Icon } from '../components/common/Icon.jsx';
import { PanelMessage } from '../components/common/Panel.jsx';
import { usePoll } from '../hooks/usePoll.js';
import { listRepos, onboardRepo } from '../services/api.js';

// Stitch screen 03: pick a repo from the Kairo GitHub App's installations (FR-3).
// Private repos are listed but disabled (FR-6). Connecting or changing repo
// access is a full-page trip to GitHub through /api/auth/install.
export function AddRepoPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data, error, loading } = usePoll(listRepos, null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(null);
  const [rowError, setRowError] = useState(null);

  const repos = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.repos ?? []).filter((r) => !q || r.fullName.toLowerCase().includes(q));
  }, [data, query]);

  async function add(repo) {
    setBusy(repo.fullName);
    setRowError(null);
    try {
      const run = await onboardRepo(repo.fullName);
      navigate(`/deployments/${run.id}`);
    } catch (err) {
      // e.g. "Limit of 3 running apps reached" (409)
      setRowError({ fullName: repo.fullName, message: err.message });
      setBusy(null);
    }
  }

  const installations = data?.installations ?? [];
  const limit = data?.limit;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <nav className="font-mono text-code-md text-on-surface-variant" aria-label="Breadcrumb">
          <Link to="/" className="hover:text-on-surface">Apps</Link> / <span className="text-primary">Add a repo</span>
        </nav>
        <h1 className="mt-1 text-headline-xl font-semibold">Add a repo</h1>
      </div>

      {params.get('error') === 'install-not-found' && (
        <p role="alert" className="rounded border border-error/40 bg-error-container/20 px-3 py-2 text-body-md text-error">
          GitHub didn't list that installation for your account. If you installed the App on an organization, ask an owner to approve it.
        </p>
      )}

      {loading && <PanelMessage>Loading your repos…</PanelMessage>}
      {error && !data && <PanelMessage tone="bad">{error.message}</PanelMessage>}

      {data && installations.length === 0 && (
        <section className="rounded border border-outline-variant bg-surface-container-low p-6 text-center">
          <Icon name="link" className="text-[28px] text-primary" />
          <h2 className="mt-2 text-headline-md font-semibold">Connect your repos</h2>
          <p className="mx-auto mt-1 max-w-md text-body-md text-on-surface-variant">
            Install the Kairo GitHub App and choose which repos it may see. Kairo only opens pull requests on the repos you pick.
          </p>
          <a
            href="/api/auth/install"
            className="mt-4 inline-flex items-center gap-2 rounded bg-primary-container px-4 py-2 text-body-lg font-medium text-on-primary-container hover:brightness-110"
          >
            <Icon name="open_in_new" className="text-[18px]" /> Connect repos
          </a>
        </section>
      )}

      {installations.length > 0 && (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded border border-outline-variant bg-surface-container-low px-4 py-3">
            <p className="flex items-center gap-2 text-body-lg">
              <Icon name="check_circle" className="text-[18px] text-tertiary" />
              <span>
                Kairo GitHub App installed on{' '}
                {installations.map((i, n) => (
                  <span key={i.id}>
                    {n > 0 && ', '}
                    <span className="font-mono">{i.accountLogin}</span>
                  </span>
                ))}{' '}
                · access to {data.repos.length} repo{data.repos.length === 1 ? '' : 's'}
              </span>
            </p>
            <a href="/api/auth/install" className="inline-flex items-center gap-1 text-body-md text-primary hover:underline">
              Change repo access on GitHub <Icon name="open_in_new" className="text-[16px]" />
            </a>
          </section>

          <label className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 focus-within:border-primary">
            <Icon name="search" className="text-[18px] text-on-surface-variant" />
            <span className="sr-only">Search your repos</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your repos"
              className="min-w-0 flex-1 bg-transparent font-mono text-code-md text-on-surface placeholder:text-outline focus:outline-none"
            />
          </label>

          <ul className="divide-y divide-outline-variant rounded border border-outline-variant bg-surface-container-low">
            {repos.length === 0 && <li><PanelMessage>No repos match.</PanelMessage></li>}
            {repos.map((r) => (
              <RepoRow
                key={r.fullName}
                repo={r}
                busy={busy === r.fullName}
                disabled={busy !== null}
                error={rowError?.fullName === r.fullName ? rowError.message : null}
                onAdd={() => add(r)}
              />
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body-md text-on-surface-variant">Kairo supports Node.js and Python repos for now.</p>
            {limit && limit.running !== null && <LimitNote running={limit.running} max={limit.max} />}
          </div>
          <p className="text-body-md text-on-surface-variant">
            Don't see your repo?{' '}
            <a href="/api/auth/install" className="text-primary hover:underline">Give the Kairo app access to it on GitHub.</a>
          </p>
        </>
      )}
    </div>
  );
}

function RepoRow({ repo, busy, disabled, error, onAdd }) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Icon name="folder_code" className="text-[20px] text-on-surface-variant" />
        <a href={repo.htmlUrl} target="_blank" rel="noreferrer" className="font-mono text-body-lg hover:text-primary">
          {repo.fullName}
        </a>
        <span className="rounded border border-outline-variant px-2 py-0.5 font-mono text-code-sm text-on-surface-variant">
          {repo.private ? 'Private' : 'Public'}
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-code-md text-on-surface-variant">
          <Icon name="alt_route" className="text-[16px]" /> {repo.defaultBranch}
        </span>
        <span className="text-body-md text-on-surface-variant">pushed {relativeTime(repo.pushedAt)}</span>

        <div className="ml-auto flex items-center gap-3">
          {repo.disabledReason ? (
            <span className="text-body-md text-on-surface-variant">{repo.disabledReason}</span>
          ) : repo.app ? (
            <>
              <button type="button" onClick={onAdd} disabled={disabled} className="text-body-md text-primary hover:underline disabled:opacity-50">
                {busy ? 'Starting…' : 'Deploy again'}
              </button>
              <span className="inline-flex items-center gap-1 rounded border border-tertiary/40 bg-tertiary/10 px-3 py-1 font-mono text-code-md text-tertiary">
                <Icon name="check" className="text-[16px]" /> Added
              </span>
            </>
          ) : (
            <button
              type="button"
              onClick={onAdd}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded bg-primary-container px-4 py-1.5 text-body-lg font-medium text-on-primary-container hover:brightness-110 disabled:opacity-50"
            >
              {busy && <Icon name="progress_activity" spin className="text-[16px]" />}
              {busy ? 'Starting…' : 'Add'}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 flex items-center gap-1.5 text-body-md text-error">
          <Icon name="error" className="text-[16px]" /> {error}
        </p>
      )}
    </li>
  );
}

function LimitNote({ running, max }) {
  const left = Math.max(0, max - running);
  return (
    <p className="inline-flex items-center gap-2 rounded border border-outline-variant px-3 py-2 text-body-md">
      <Icon name="info" className="text-[16px] text-primary" />
      {left > 0
        ? `${running} of ${max} apps are running. You can add ${left} more.`
        : `${running} of ${max} apps are running. Delete one before adding another.`}
    </p>
  );
}
