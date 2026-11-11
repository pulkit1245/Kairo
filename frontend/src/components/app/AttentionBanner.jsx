import { Icon } from '../common/Icon.jsx';
import { offersRollback } from './ReleaseTable.jsx';

// Shown while the app NEEDS_ATTENTION (FR-48, FR-49, FR-73, Stitch 10):
// Kairo has stopped acting on it, says why, and how it clears. "Roll back
// manually" goes to the release list (FR-61); "View GitHub issue" opens the
// issue Kairo filed when it stopped (FR-55).
export function AttentionBanner({ app }) {
  if (app.health !== 'NEEDS_ATTENTION') return null;
  // the newest incident that opened or commented on the app's issue
  const issue = app.incidents?.find((i) => i.githubIssueUrl);
  const canRollBack = app.releases.some(offersRollback);
  return (
    <section role="alert" className="flex flex-wrap items-start gap-3 rounded border border-error/40 bg-error-container/20 px-4 py-4">
      <Icon name="error" className="text-[24px] text-error" />
      <div className="flex min-w-[260px] flex-1 flex-col gap-1">
        <h2 className="text-headline-md font-semibold text-error">Needs attention</h2>
        <p className="text-body-lg">
          Kairo stopped acting on this app
          {app.attentionReason ? `: ${app.attentionReason}.` : '. The reason was lost when the backend restarted; see the incidents below.'}
        </p>
        <p className="text-body-md text-on-surface-variant">
          It clears by itself once the alerts stay quiet for 10 minutes, when a new release is marked healthy, or after a manual
          rollback that Kairo verifies.
          {!app.autoHeal && ' Auto-heal is off, so even then Kairo only records incidents until it is turned on.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canRollBack && (
          <button
            type="button"
            onClick={() => document.getElementById('releases')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="inline-flex items-center gap-2 rounded border border-error bg-error-container px-3 py-2 text-body-md font-semibold text-on-surface hover:brightness-110"
          >
            <Icon name="history" className="text-[18px]" /> Roll back manually
          </button>
        )}
        {issue && (
          <a
            href={issue.githubIssueUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded border border-outline-variant bg-surface-container px-3 py-2 text-body-md hover:bg-surface-container-high"
          >
            <Icon name="bug_report" className="text-[18px]" /> View GitHub issue #{issue.githubIssueNumber}
          </a>
        )}
      </div>
    </section>
  );
}
