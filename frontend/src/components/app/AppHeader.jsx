import { Link } from 'react-router';
import { relativeTime, shortSha } from '../common/format.js';
import { Icon } from '../common/Icon.jsx';
import { HEALTH, runStatus, stackLabel, TONE_CLASS } from '../common/status.js';
import { StatusBadge } from '../common/StatusBadge.jsx';
import { AutoHealToggle } from './AutoHealToggle.jsx';

// The app's header (FR-59, Stitch 07). The Overview shows it in full:
// pipeline status, health, active release, public link, PR link, the
// auto-heal toggle and Delete. The other screens show the first line only
// (name, stack, health, active release), so their own content starts higher.

const PR_LABEL = { OPEN: 'Open', MERGED: 'Merged', CLOSED: 'Closed', FAILED: "Couldn't open" };

export function AppHeader({ app, now, full, onDelete }) {
  const health = HEALTH[app.health] ?? HEALTH.HEALTHY;
  const r = app.release;
  return (
    <header className={`flex flex-col gap-3 rounded border border-outline-variant bg-surface-container-low px-4 ${full ? 'py-4' : 'py-3'}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Icon name="deployed_code" className="text-[22px] text-primary" />
        <h1 className="min-w-0 break-all font-mono text-headline-xl font-semibold">{app.slug}</h1>
        {app.stack && (
          <span className="rounded border border-outline-variant bg-surface-container-high px-2 py-0.5 font-mono text-code-sm text-on-surface-variant">
            {stackLabel(app.stack)}
          </span>
        )}
        <span className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-0.5 font-mono text-code-sm font-semibold ${health.box} ${TONE_CLASS[health.tone]}`}>
          <Icon name={health.icon} className="text-[15px]" /> {health.label}
        </span>
        {r ? (
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-body-md text-on-surface-variant">
            <span className="text-outline">Active:</span>
            <code className="rounded border border-outline-variant bg-surface-container px-1.5 py-0.5 font-mono text-code-sm text-primary" title={r.commitSha}>
              {shortSha(r.commitSha)}
            </code>
            {r.commitMessage && <span className="min-w-0 break-words text-on-surface">{r.commitMessage}</span>}
            <span className="text-outline">
              · {r.source === 'GHCR' ? 'GHCR' : r.source === 'TEST' ? 'Break It' : 'preview'} · {relativeTime(r.deployedAt, now)}
            </span>
          </span>
        ) : (
          <span className="text-body-md text-on-surface-variant">No running release</span>
        )}
      </div>

      {full && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-code-sm">
          <a href={app.repoUrl} target="_blank" rel="noreferrer" className="inline-flex min-w-0 max-w-full items-center gap-1 text-primary hover:underline">
            <span className="min-w-0 truncate">{app.repoFullName}</span> <Icon name="open_in_new" className="shrink-0 text-[14px]" />
          </a>
          {app.publicUrl ? (
            <a
              href={app.publicUrl}
              target="_blank"
              rel="noreferrer"
              title={app.publicUrl}
              className="inline-flex min-w-0 max-w-full items-center gap-1 text-primary hover:underline"
            >
              <span className="min-w-0 truncate">{app.publicUrl}</span> <Icon name="open_in_new" className="shrink-0 text-[14px]" />
            </a>
          ) : (
            app.tunnel && (
              <span className="text-on-surface-variant">
                {app.tunnel === 'restarting' ? 'Public link dropped; restarting it…' : 'Starting the public link…'}
              </span>
            )
          )}
          {app.pr.number && app.pr.url ? (
            <a href={app.pr.url} target="_blank" rel="noreferrer" className="rounded border border-outline-variant bg-surface-container px-2 py-0.5 text-secondary hover:underline">
              PR #{app.pr.number} {PR_LABEL[app.pr.state] ?? ''}
            </a>
          ) : (
            <span className="rounded border border-outline-variant px-2 py-0.5 text-on-surface-variant">
              {app.installed ? 'No PR yet' : 'No PR (URL shortcut)'}
            </span>
          )}
          {app.pipeline && (
            <Link to={`/deployments/${app.pipeline.id}`} className="inline-flex items-center gap-1.5 hover:underline">
              <span className="text-outline">Last run:</span>
              <StatusBadge status={runStatus(app.pipeline)} className="text-code-sm" />
            </Link>
          )}
          <AutoHealToggle app={app} />
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-error/40 px-2.5 py-1 font-mono text-code-sm text-error hover:bg-error-container/20"
          >
            <Icon name="delete" className="text-[15px]" /> Delete app
          </button>
        </div>
      )}
    </header>
  );
}
