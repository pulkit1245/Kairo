import { useState } from 'react';
import { retryPr } from '../../services/api.js';
import { Icon } from '../common/Icon.jsx';

// The setup PR (Stitch 04, FR-30 to FR-34, AQ11). States: not yet (waiting
// for a healthy preview), OPEN, MERGED, CLOSED, FAILED (with Try again).
const STATE = {
  OPEN: { label: 'Open', icon: 'merge_type', tone: 'text-tertiary border-tertiary/40 bg-tertiary/10' },
  MERGED: { label: 'Merged', icon: 'merge', tone: 'text-secondary border-secondary/40 bg-secondary/10' },
  CLOSED: { label: 'Closed', icon: 'block', tone: 'text-on-surface-variant border-outline-variant' },
  FAILED: { label: "Couldn't open", icon: 'error', tone: 'text-error border-error/40 bg-error-container/20' },
};

export function PrCard({ run, onChanged }) {
  const { pr } = run;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!run.installed) {
    return (
      <Card title="Pull request">
        <p className="text-body-md text-on-surface-variant">
          Started from a pasted URL (the testing shortcut), so there is no PR. Pick the repo under <strong>Add a repo</strong> to get one.
        </p>
      </Card>
    );
  }

  async function tryAgain() {
    setBusy(true);
    setError(null);
    try {
      await retryPr(run.appName);
      await onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!pr.state) {
    return (
      <Card title="Pull request">
        <p className="flex items-center gap-2 text-body-md text-on-surface-variant">
          <Icon name="hourglass_top" className="text-[18px]" />
          Kairo opens the PR once the preview is marked healthy.
        </p>
      </Card>
    );
  }

  const s = STATE[pr.state];
  return (
    <Card
      title={pr.number ? `#${pr.number} Set up Kairo` : 'Pull request'}
      badge={
        <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-code-sm ${s.tone}`}>
          <Icon name={s.icon} className="text-[14px]" /> {s.label}
        </span>
      }
    >
      {pr.number && pr.bot && (
        <p className="font-mono text-code-md text-on-surface-variant">
          opened by <strong className="text-on-surface">{pr.bot}</strong> on <code>kairo/setup</code>
        </p>
      )}
      {pr.state === 'FAILED' && <p className="mt-2 text-body-md text-error">{pr.error}</p>}
      {pr.url && (
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-center gap-2 rounded border border-outline-variant px-3 py-2 text-body-lg hover:bg-surface-container"
        >
          <Icon name="open_in_new" className="text-[18px]" /> Open on GitHub
        </a>
      )}
      {pr.state === 'FAILED' && (
        <button
          type="button"
          onClick={tryAgain}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-2 rounded bg-primary-container px-4 py-2 text-body-lg font-medium text-on-primary-container hover:brightness-110 disabled:opacity-50"
        >
          <Icon name={busy ? 'progress_activity' : 'refresh'} spin={busy} className="text-[18px]" />
          {busy ? 'Trying…' : 'Try again'}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-body-md text-error">
          {error}
        </p>
      )}
      <p className="mt-3 text-body-md text-on-surface-variant">
        {pr.state === 'MERGED'
          ? `Merged: new pushes are built by GitHub Actions and rolled out by Kairo.`
          : pr.state === 'CLOSED'
            ? 'Closed without merging: the preview keeps running, but Kairo won\'t watch GHCR.'
            : `Merge it to switch ${run.appName} to images built by GitHub Actions.`}
      </p>
    </Card>
  );
}

function Card({ title, badge, children }) {
  return (
    <section className="rounded border border-outline-variant bg-surface-container-low p-4" aria-label="Pull request">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-headline-md font-semibold">
          <Icon name="merge_type" className="text-[20px] text-tertiary" /> {title}
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}
