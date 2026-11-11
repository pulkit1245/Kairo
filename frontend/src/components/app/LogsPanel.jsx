import { useEffect, useRef, useState } from 'react';
import { utcClock } from '../common/format.js';
import { Icon } from '../common/Icon.jsx';
import { usePoll } from '../../hooks/usePoll.js';
import { getAppLogs } from '../../services/api.js';

// The newest pod's last 50 lines, every 5 s (FR-58, Stitch 07). Pause stops
// the refresh; the filter only hides lines on screen.
const POLL_MS = 5000;

const time = (iso) => (iso ? `${utcClock(iso, true)}.${iso.slice(20, 23)}` : '');
// a quick, readable tint: errors red, warnings yellow
const tint = (text) => (/error|exception|fatal|traceback|exit/i.test(text) ? 'text-error' : /warn/i.test(text) ? 'text-warning' : 'text-on-surface');

export function LogsPanel({ slug }) {
  // paused = the lines on screen stay as they were when Pause was clicked
  const [frozen, setFrozen] = useState(null);
  const paused = frozen !== null;
  const [filter, setFilter] = useState('');
  const live = usePoll(() => getAppLogs(slug), paused ? null : POLL_MS, [slug, paused]);
  const data = frozen ?? live.data;
  const error = live.error;
  const box = useRef(null);
  const atBottom = useRef(true);

  const lines = (data?.lines ?? []).filter((l) => !filter || l.text.toLowerCase().includes(filter.toLowerCase()));

  // follow new lines, unless the reader scrolled up
  useEffect(() => {
    if (box.current && atBottom.current) box.current.scrollTop = box.current.scrollHeight;
  }, [data]);

  return (
    <section className="flex min-w-0 flex-col rounded border border-outline-variant bg-surface-container-low">
      <header className="flex flex-wrap items-center gap-2 border-b border-outline-variant px-4 py-3">
        <h2 className="flex items-center gap-2 font-mono text-code-md uppercase tracking-wider text-on-surface-variant">
          <span className={`size-2 rounded-full ${paused ? 'bg-outline' : 'bg-tertiary'}`} aria-hidden="true" /> App logs
        </h2>
        <span className="truncate font-mono text-code-sm text-secondary" title="The newest pod">
          {data?.pod ?? ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 rounded border border-outline-variant bg-surface-container px-2 py-1">
            <Icon name="filter_list" className="text-[14px] text-on-surface-variant" />
            <span className="sr-only">Filter logs</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter logs…"
              className="w-28 bg-transparent font-mono text-code-sm outline-none placeholder:text-outline"
            />
          </label>
          <button
            type="button"
            onClick={() => setFrozen(paused ? null : (live.data ?? { pod: null, lines: [] }))}
            aria-pressed={paused}
            className="flex items-center gap-1 rounded border border-outline-variant bg-surface-container px-2 py-1 font-mono text-code-sm hover:bg-surface-container-high"
          >
            <Icon name={paused ? 'play_arrow' : 'pause'} className="text-[14px]" /> {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </header>

      {data?.previous && (
        <p className="border-b border-outline-variant bg-warning/10 px-4 py-1.5 font-mono text-code-sm text-warning">
          The container is waiting to restart; these lines are from its last run.
        </p>
      )}

      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="h-[360px] overflow-y-auto bg-surface-container-lowest px-4 py-3 font-mono text-code-md"
        aria-live="off"
      >
        {error && !data && <p className="text-error">{error.message}</p>}
        {data && data.pod === null && <p className="text-on-surface-variant">The app has no pod right now.</p>}
        {data && data.pod !== null && lines.length === 0 && (
          <p className="text-on-surface-variant">{filter ? 'No line matches the filter.' : 'The pod has written nothing yet.'}</p>
        )}
        {lines.map((l, n) => (
          <div key={`${l.time}-${n}`} className="flex gap-3 whitespace-pre-wrap break-all leading-5">
            <span className="shrink-0 text-outline">{time(l.time)}</span>
            <span className={tint(l.text)}>{l.text}</span>
          </div>
        ))}
      </div>
      <footer className="border-t border-outline-variant px-4 py-1.5 font-mono text-code-sm text-on-surface-variant">
        {paused ? 'Paused' : 'Last 50 lines · refreshes every 5 s'}
        {data?.fetchedAt && ` · read ${utcClock(data.fetchedAt, true)} UTC`}
        {error && data && <span className="text-error"> · {error.message}</span>}
      </footer>
    </section>
  );
}
