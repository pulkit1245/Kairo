import { useState } from 'react';
import { Icon } from '../common/Icon.jsx';

// Where the running app answers. Traefik routes <slug>.kairo.local on
// localhost:80 (FR-23). The public tunnel link replaces this in P4.
export function PreviewPanel({ appName }) {
  const host = `${appName}.kairo.local`;
  const curl = `curl -H "Host: ${host}" http://localhost/`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard can be blocked; the command is on screen anyway
    }
  }

  return (
    <section className="rounded border border-outline-variant bg-surface-container-low p-4" aria-labelledby="preview-title">
      <h2 id="preview-title" className="flex items-center gap-2 text-headline-md font-semibold">
        <Icon name="visibility" className="text-[20px] text-primary" />
        Preview
      </h2>
      <a
        href={`http://${host}/`}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex items-center justify-between gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-mono text-code-md text-primary hover:underline"
      >
        <span className="truncate">http://{host}</span>
        <Icon name="open_in_new" className="text-[16px]" />
      </a>
      <p className="mt-2 text-body-sm text-on-surface-variant">
        The link needs <code className="font-mono">127.0.0.1 {host}</code> in <code className="font-mono">/etc/hosts</code>. Without it:
      </p>
      <div className="mt-1 flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-code-md">{curl}</code>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 font-mono text-code-sm text-on-surface-variant hover:text-on-surface">
          <Icon name={copied ? 'check' : 'content_copy'} className="text-[16px]" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </section>
  );
}
