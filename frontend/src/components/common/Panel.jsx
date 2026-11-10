// The bordered box every list sits in, with the loading, error and empty states
// handled the same way everywhere.
export function Panel({ title, meta, children }) {
  return (
    <section className="rounded border border-outline-variant bg-surface-container-low">
      {(title || meta) && (
        <header className="flex items-center justify-between gap-4 border-b border-outline-variant px-4 py-3">
          <h2 className="font-mono text-code-md uppercase tracking-wider text-on-surface-variant">{title}</h2>
          {meta && <div className="font-mono text-code-sm text-on-surface-variant">{meta}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PanelMessage({ children, tone = 'muted' }) {
  const color = tone === 'bad' ? 'text-error' : 'text-on-surface-variant';
  return <p className={`px-4 py-8 text-center text-body-md ${color}`}>{children}</p>;
}
