import { usePoll } from '../../hooks/usePoll.js';
import { getHealth } from '../../services/api.js';

// API, Database, Cluster and Healing pills from GET /api/health, every 10 s.
// A Gemini pill joins in P4. Each pill is a dot plus a word, never color alone.
const HEALTH_POLL_MS = 10_000;

function Pill({ label, state }) {
  const dot = { up: 'bg-tertiary', down: 'bg-error', checking: 'bg-outline', unknown: 'bg-outline', live: 'bg-tertiary', 'dry run': 'bg-warning' }[state];
  const word = { up: 'up', down: 'down', checking: 'checking', unknown: 'unknown' }[state] ?? state;
  return (
    <li
      className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-low px-2.5 py-1 font-mono text-code-md"
      title={`${label} is ${word}`}
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

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Platform health">
      <Pill label="API" state={api} />
      <Pill label="Database" state={part('db')} />
      <Pill label="Cluster" state={part('cluster')} />
      <Pill label="Healing" state={healing} />
    </ul>
  );
}
