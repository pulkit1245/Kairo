import { useState } from 'react';
import { Icon } from '../common/Icon.jsx';
import { breakApp, sendTraffic } from '../../services/api.js';

// Break the app on purpose and watch Kairo detect, act and verify (FR-62,
// FR-63, Stitch 07). Send Traffic's progress comes from the app's `traffic`
// field, which the page polls every 5 s.

const BUTTON = 'flex items-center gap-2 rounded border px-4 py-2.5 text-body-lg disabled:cursor-not-allowed disabled:opacity-50';

export function TestPanel({ app, now }) {
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  // the broken release asks once more before it goes out
  const [confirmBroken, setConfirmBroken] = useState(false);

  const t = app.traffic;
  const sending = t?.running && Date.parse(t.endsAt) > now;

  async function run(key, fn, done) {
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ tone: 'ok', text: done(await fn()) });
    } catch (err) {
      setMessage({ tone: 'bad', text: err.message });
    } finally {
      setBusy(null);
      setConfirmBroken(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded border-2 border-dashed border-error/40 px-4 py-4" aria-labelledby="test-panel-title">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded border border-error/40 bg-error-container/20 px-2 py-0.5 font-mono text-code-sm uppercase tracking-wider text-error">
          <Icon name="warning" className="text-[14px]" /> Test scenarios
        </span>
        <h2 id="test-panel-title" className="text-headline-md font-semibold">
          Test panel
        </h2>
      </div>
      <p className="text-body-md text-on-surface-variant">Break the app on purpose and watch Kairo detect, act and verify.</p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={Boolean(busy) || sending}
          onClick={() =>
            run('traffic', () => sendTraffic(app.slug), (r) => `Sending ${r.rps} req/s to ${r.path} for 60 s. Watch the charts and the replicas.`)
          }
          className={`${BUTTON} border-outline-variant bg-surface-container hover:bg-surface-container-high`}
        >
          <Icon name={sending ? 'progress_activity' : 'bolt'} spin={sending} className="text-[18px] text-primary" />
          {sending ? 'Sending traffic…' : 'Send traffic (50 req/s for 60 s)'}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() =>
            run('kill', () => breakApp(app.slug, 'kill-pod'), (r) => `Deleted pod ${r.pod}. Kubernetes replaces it by itself; Kairo doesn't need to act.`)
          }
          className={`${BUTTON} border-error/50 text-error hover:bg-error-container/20`}
        >
          <Icon name="cancel" className="text-[18px]" /> Kill a pod
        </button>
        {confirmBroken ? (
          <span className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() =>
                run(
                  'broken',
                  () => breakApp(app.slug, 'broken-release'),
                  () => 'Deployed a release that exits on start. The old pod keeps serving; Kairo should roll back within about 2 minutes.',
                )
              }
              className={`${BUTTON} border-error bg-error-container text-on-surface hover:brightness-110`}
            >
              <Icon name={busy === 'broken' ? 'progress_activity' : 'check'} spin={busy === 'broken'} className="text-[18px]" /> Yes, deploy it
            </button>
            <button type="button" onClick={() => setConfirmBroken(false)} className="px-2 text-body-md text-on-surface-variant hover:text-on-surface">
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => setConfirmBroken(true)}
            className={`${BUTTON} border-error bg-error-container text-on-surface hover:brightness-110`}
          >
            <Icon name="dangerous" className="text-[18px]" /> Deploy a broken release (exits on start)
          </button>
        )}
      </div>

      {t && <TrafficLine t={t} now={now} />}
      {message && (
        <p role="status" className={`font-mono text-code-md ${message.tone === 'bad' ? 'text-error' : 'text-tertiary'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

// "Sending: 1,234 sent · 1,230 ok · 4 failed · 23 s left"
function TrafficLine({ t, now }) {
  const left = Math.max(0, Math.round((Date.parse(t.endsAt) - now) / 1000));
  const running = t.running && left > 0;
  return (
    <p className="font-mono text-code-sm text-on-surface-variant">
      <span className={running ? 'text-primary' : ''}>{running ? 'Sending' : 'Last run'}</span>
      {` ${t.path} · ${t.sent.toLocaleString()} sent · ${t.ok.toLocaleString()} ok · `}
      <span className={t.failed > 0 ? 'text-error' : ''}>{t.failed.toLocaleString()} failed</span>
      {running ? ` · ${left} s left` : ''}
    </p>
  );
}
