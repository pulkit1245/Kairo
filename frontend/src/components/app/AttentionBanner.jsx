import { Icon } from '../common/Icon.jsx';

// Shown while the app NEEDS_ATTENTION (FR-48, FR-49, FR-73, Stitch 10):
// Kairo has stopped acting on it, says why, and how it clears. Manual
// rollback and the GitHub issue join this banner in P4.
export function AttentionBanner({ app }) {
  if (app.health !== 'NEEDS_ATTENTION') return null;
  return (
    <section role="alert" className="flex items-start gap-3 rounded border border-error/40 bg-error-container/20 px-4 py-4">
      <Icon name="error" className="text-[24px] text-error" />
      <div className="flex flex-col gap-1">
        <h2 className="text-headline-md font-semibold text-error">Needs attention</h2>
        <p className="text-body-lg">
          Kairo stopped acting on this app
          {app.attentionReason ? `: ${app.attentionReason}.` : '. The reason was lost when the backend restarted; see the incidents below.'}
        </p>
        <p className="text-body-md text-on-surface-variant">
          It clears by itself once the alerts stay quiet for 10 minutes, or when a new release is marked healthy.
          {!app.autoHeal && ' Auto-heal is off, so even then Kairo only records incidents until it is turned on.'}
        </p>
      </div>
    </section>
  );
}
