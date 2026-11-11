import { usePoll } from '../../hooks/usePoll.js';
import { getHealth } from '../../services/api.js';

// API, Database, Cluster, Healing and Gemini pills from GET /api/health, every
// 10 s. Each pill is a dot plus a word, never color alone.
const HEALTH_POLL_MS = 10_000;

function Pill({ label, state, title }) {
  const dot = { up: 'bg-tertiary', down: 'bg-error', checking: 'bg-outline', unknown: 'bg-outline', live: 'bg-tertiary', 'dry run': 'bg-warning', off: 'bg-outline' }[state];
  const word = { up: 'up', down: 'down', checking: 'checking', unknown: 'unknown' }[state] ?? state;
  return (
    <li
      className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-low px-2.5 py-1 font-mono text-code-md"
      title={title ?? `${label} is ${word}`}
    >
      <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      <span>{label}</span>
      <span className={state === 'down' ? 'text-error' : state === 'dry run' ? 'text-warning' : 'text-on-surface-variant'}>{word}</span>
    </li>
  );
}

export function HealthPills() {
  const { data, error, loading } = usePoll(getHealth, HEALTH_POLL_MS);

  // if the API itself doesn't answer, we can't know about the other two
  const api = loading ? 'checking' : error ? 'down' : 'up';
  const part = (key) => {
    if (api === 'checking') return 'checking';
    if (api === 'down' || !data) return 'unknown';
    return data[key] === 'up' ? 'up' : 'down';
  };

  // live = Kairo really restarts pods; dry run = it only records incidents
  let healing = 'unknown';
  if (api === 'checking') healing = 'checking';
  else if (api === 'up' && data) healing = data.dryRun ? 'dry run' : 'live';

  // up = the last call (or the boot check) worked; down = it failed and Kairo
  // used its defaults; off = GEMINI_ENABLED=false or no key
  let gemini = 'unknown';
  if (api === 'checking') gemini = 'checking';
  else if (api === 'up' && data?.gemini) gemini = data.gemini.state;
  const g = data?.gemini;
  const geminiTitle = g ? [`Gemini is ${g.state}`, g.model, g.detail].filter(Boolean).join(' · ') : undefined;

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Platform health">
      <Pill label="API" state={api} />
      <Pill label="Database" state={part('db')} />
      <Pill label="Cluster" state={part('cluster')} />
      <Pill label="Healing" state={healing} />
      <Pill label="Gemini" state={gemini} title={geminiTitle} />
    </ul>
  );
}
