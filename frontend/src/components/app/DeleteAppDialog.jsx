import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../common/Icon.jsx';
import { deleteApp } from '../../services/api.js';

// Delete app (FR-65, FR-66, Stitch 09): what Kairo removes, what it keeps,
// and the app's name typed to confirm. Unlike the mockup, releases and
// incidents are kept (FR-65 wins over the screen).
export function DeleteAppDialog({ app, onClose }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const input = useRef(null);
  const matched = typed === app.slug;

  useEffect(() => {
    input.current?.focus();
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function submit(e) {
    e.preventDefault();
    if (!matched || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteApp(app.slug, typed);
      navigate('/', { state: { deleted: app.slug } });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const code = 'rounded border border-outline-variant bg-surface-container px-1.5 py-0.5 font-mono text-code-md';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4">
      <div className="absolute inset-0 bg-surface-container-lowest/80" onClick={() => !busy && onClose()} aria-hidden="true" />
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        className="relative flex max-h-full w-full max-w-[560px] flex-col gap-4 overflow-y-auto rounded border border-outline-variant bg-surface-container-low px-5 py-5 shadow-2xl"
      >
        <header className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded border border-error/40 bg-error-container/20 text-error">
            <Icon name="delete" className="text-[22px]" />
          </span>
          <h2 id="delete-title" className="flex flex-1 flex-wrap items-center gap-2 text-headline-md font-semibold">
            Delete <code className={`${code} text-primary`}>{app.slug}</code>?
          </h2>
          <button type="button" onClick={onClose} disabled={busy} className="grid size-8 place-items-center rounded hover:bg-surface-container-high">
            <Icon name="close" label="Cancel" className="text-[18px]" />
          </button>
        </header>

        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-body-lg font-semibold text-error">
            <Icon name="do_not_disturb_on" className="text-[18px]" /> Kairo will remove
          </h3>
          <ul className="flex flex-col gap-2 rounded border border-outline-variant bg-surface-container-lowest px-4 py-3 text-body-md">
            <li className="flex gap-2"><span className="text-error">–</span> The app's namespace in the cluster: its Deployment, Service, Ingress and pods</li>
            {app.publicUrl && (
              <li className="flex flex-wrap gap-2"><span className="text-error">–</span> The public link <code className={code}>{app.publicUrl}</code></li>
            )}
            <li className="flex gap-2"><span className="text-error">–</span> Its Prometheus alert rules</li>
            <li className="flex gap-2"><span className="text-error">–</span> Its images on this laptop</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-body-lg font-semibold text-tertiary">
            <Icon name="check_circle" className="text-[18px]" /> Kairo keeps
          </h3>
          <ul className="flex flex-col gap-2 rounded border border-outline-variant bg-surface-container-lowest px-4 py-3 text-body-md">
            <li className="flex flex-wrap items-center gap-2"><Icon name="check" className="text-[16px] text-tertiary" /> Your GitHub repo <code className={code}>{app.repoFullName}</code></li>
            {app.pr.number && (
              <li className="flex flex-wrap items-center gap-2"><Icon name="check" className="text-[16px] text-tertiary" /> PR #{app.pr.number} and the files Kairo added in it</li>
            )}
            <li className="flex items-center gap-2"><Icon name="check" className="text-[16px] text-tertiary" /> Images already pushed to GHCR</li>
            <li className="flex items-center gap-2"><Icon name="check" className="text-[16px] text-tertiary" /> Its releases and incidents in Kairo</li>
          </ul>
        </section>

        <label className="flex flex-col gap-2 text-body-lg">
          <span>
            Type <code className={`${code} text-error`}>{app.slug}</code> to confirm
          </span>
          <span className={`flex items-center gap-2 rounded border bg-surface-container-lowest px-3 py-2 ${matched ? 'border-tertiary/50' : 'border-outline-variant'}`}>
            <input
              ref={input}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-body-lg outline-none"
            />
            {matched && (
              <span className="flex items-center gap-1 font-mono text-code-sm text-tertiary">
                <Icon name="check" className="text-[14px]" /> Matched
              </span>
            )}
          </span>
        </label>

        {error && <p role="alert" className="text-body-md text-error">{error}</p>}

        <footer className="flex flex-col items-end gap-2 border-t border-outline-variant pt-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 text-body-lg text-on-surface-variant hover:text-on-surface">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!matched || busy}
              className="flex items-center gap-2 rounded bg-error px-4 py-2 text-body-lg font-semibold text-error-container disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name={busy ? 'progress_activity' : 'delete_forever'} spin={busy} className="text-[18px]" /> {busy ? 'Deleting…' : 'Delete app'}
            </button>
          </div>
          <p className="text-body-sm text-on-surface-variant">This can't be undone. You can add the repo again later.</p>
        </footer>
      </form>
    </div>
  );
}
