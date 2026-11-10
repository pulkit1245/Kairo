import { useState } from 'react';
import { useNavigate } from 'react-router';
import { createDeployment } from '../../services/api.js';
import { Icon } from '../common/Icon.jsx';

// P1 entry point: paste a public GitHub URL. In P2 the repo picker from the
// GitHub App installation replaces this box (the endpoint stays as a testing
// shortcut, hidden from the UI).
export function AddRepoForm() {
  const navigate = useNavigate();
  const [repoUrl, setRepoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const run = await createDeployment(repoUrl.trim());
      navigate(`/deployments/${run.id}`);
    } catch (err) {
      // e.g. "Limit of 3 running apps reached" (409) or a bad URL (400)
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded border border-outline-variant bg-surface-container-low p-4">
      <label htmlFor="repo-url" className="mb-2 block font-mono text-code-md uppercase tracking-wider text-on-surface-variant">
        Add a repo
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="repo-url"
          type="url"
          required
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          className="min-w-0 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-code-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none"
          aria-describedby={error ? 'repo-url-error' : undefined}
        />
        <button
          type="submit"
          disabled={busy || !repoUrl.trim()}
          className="inline-flex items-center justify-center gap-2 rounded bg-primary-container px-4 py-2 text-body-lg font-medium text-on-primary-container hover:brightness-110 disabled:opacity-50"
        >
          <Icon name={busy ? 'progress_activity' : 'add'} spin={busy} className="text-[18px]" />
          {busy ? 'Starting…' : 'Deploy'}
        </button>
      </div>
      {error && (
        <p id="repo-url-error" role="alert" className="mt-2 flex items-center gap-1.5 text-body-md text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}
      <p className="mt-2 text-body-sm text-on-surface-variant">
        Public GitHub repos with a <code className="font-mono">package.json</code> or <code className="font-mono">requirements.txt</code> in the root. Up to 3 running apps.
      </p>
    </form>
  );
}
