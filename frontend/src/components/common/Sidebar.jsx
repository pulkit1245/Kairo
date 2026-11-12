import { Link, NavLink, useLocation, useMatch } from 'react-router';
import { Icon } from './Icon.jsx';
import { HEALTH, TONE_CLASS } from './status.js';

// The sidebar holds only things Kairo has (Stitch README, "Sidebar"): Apps,
// each app with its health, the viewed app's dashboard sections, and a small
// cluster card. No Settings, no cross-app pages: an app's incidents and logs
// live on its one dashboard page, and the section links jump within it.
//
// `apps` is the Layout's poll of GET /api/apps, shared with the Apps page.

// ids on the app page (AppPage.jsx and its panels). Overview is the top
export const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'incidents', label: 'Incidents', icon: 'emergency_home' },
  { id: 'logs', label: 'Logs', icon: 'terminal' },
  { id: 'releases', label: 'Releases', icon: 'history' },
  { id: 'test-panel', label: 'Test panel', icon: 'science' },
];

export function Sidebar({ apps }) {
  const list = apps.data;
  return (
    <aside className="hidden w-56 shrink-0 border-r border-outline-variant bg-surface-container-low md:block">
      <div className="sticky top-0 flex h-screen flex-col">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="grid size-8 place-items-center rounded bg-primary-container text-on-primary-container">
            <Icon name="deployed_code" className="text-[20px]" />
          </span>
          <span className="text-headline-md font-semibold">Kairo</span>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3" aria-label="Main">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded px-3 py-2 text-body-lg ${
                isActive
                  ? 'border-l-2 border-primary bg-surface-container-high text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
              }`
            }
          >
            <Icon name="apps" className="text-[18px]" /> Apps
          </NavLink>
          {list?.apps.length > 0 && (
            <ul className="flex flex-col gap-0.5 pl-2" aria-label="Apps">
              {list.apps.map((app) => (
                <AppItem key={app.id} app={app} />
              ))}
            </ul>
          )}
        </nav>
        {list && <ClusterCard list={list} />}
      </div>
    </aside>
  );
}

function AppItem({ app }) {
  const viewing = useMatch('/apps/:slug')?.params.slug === app.slug;
  const h = appHealth(app);
  return (
    <li>
      <Link
        to={`/apps/${app.slug}`}
        aria-current={viewing ? 'page' : undefined}
        className={`flex min-w-0 items-center gap-2 rounded px-2 py-1.5 ${
          viewing ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
        }`}
      >
        <span className={`size-2 shrink-0 rounded-full bg-current ${TONE_CLASS[h.tone]}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-code-md" title={app.slug}>
            {app.slug}
          </span>
          <span className={`block text-code-sm ${TONE_CLASS[h.tone]}`}>{h.label}</span>
        </span>
      </Link>
      {viewing && <Sections app={app} />}
    </li>
  );
}

// the viewed app's dashboard sections, as links to #ids on its page
function Sections({ app }) {
  const { hash } = useLocation();
  const current = hash.slice(1) || 'overview';
  return (
    <ul className="my-1 ml-3 flex flex-col border-l border-outline-variant" aria-label={`${app.slug} sections`}>
      {SECTIONS.map((s) => {
        const active = s.id === current;
        return (
          <li key={s.id}>
            <Link
              to={`/apps/${app.slug}#${s.id}`}
              aria-current={active ? 'location' : undefined}
              className={`-ml-px flex items-center gap-2 border-l-2 py-1 pl-3 pr-2 text-body-md ${
                active ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <Icon name={s.icon} className="text-[16px]" />
              <span className="flex-1">{s.label}</span>
              {s.id === 'incidents' && app.openIncidents > 0 && (
                <span
                  className="rounded border border-warning/40 bg-warning/10 px-1.5 font-mono text-code-sm text-warning"
                  title={`${app.openIncidents} open incident${app.openIncidents === 1 ? '' : 's'}`}
                >
                  {app.openIncidents}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// health as a dot and a word; an app with nothing deployed says why
function appHealth(app) {
  if (!app.release) {
    if (app.pipeline?.status === 'FAILED') return { label: 'Onboarding failed', tone: 'bad' };
    if (app.pipeline && app.pipeline.status !== 'RUNNING') return { label: 'Onboarding…', tone: 'busy' };
    return { label: 'Not running', tone: 'muted' };
  }
  const h = HEALTH[app.health] ?? HEALTH.HEALTHY;
  return { label: h.label, tone: h.tone };
}

// apps against the 3-app limit, and the node's CPU and memory (GET /api/apps
// `cluster`, null when Prometheus didn't answer in time)
function ClusterCard({ list }) {
  const c = list.cluster ?? {};
  // decimal GB, like Docker Desktop's "5 GB" memory cap
  const gb = (b) => (b / 1e9).toFixed(1);
  const rows = [
    { label: 'Apps', used: list.running, total: list.maxRunning, text: `${list.running} of ${list.maxRunning}` },
    {
      label: 'CPU',
      used: c.cpuCores,
      total: c.cpuTotal,
      text: c.cpuCores != null && c.cpuTotal != null ? `${c.cpuCores.toFixed(1)} of ${c.cpuTotal} cores` : '—',
    },
    {
      label: 'Memory',
      used: c.memoryBytes,
      total: c.memoryTotalBytes,
      text: c.memoryBytes != null && c.memoryTotalBytes != null ? `${gb(c.memoryBytes)} of ${gb(c.memoryTotalBytes)} GB` : '—',
    },
  ];
  return (
    <section className="m-2 rounded border border-outline-variant bg-surface-container px-3 py-2.5" aria-label="Cluster">
      <h2 className="mb-1.5 flex items-center gap-1.5 font-mono text-code-sm uppercase tracking-wider text-on-surface-variant">
        <Icon name="dns" className="text-[14px]" /> Cluster
      </h2>
      <dl className="flex flex-col gap-2">
        {rows.map((r) => {
          const share = r.used != null && r.total ? Math.min(1, r.used / r.total) : null;
          return (
            <div key={r.label}>
              <div className="flex items-baseline justify-between gap-2 font-mono text-code-sm">
                <dt className="text-on-surface-variant">{r.label}</dt>
                <dd className="text-on-surface">{r.text}</dd>
              </div>
              <div className="mt-1 h-1 rounded-full bg-surface-container-highest" aria-hidden="true">
                {share !== null && (
                  <span
                    className={`block h-full rounded-full ${share >= 0.85 ? 'bg-error' : share >= 0.7 ? 'bg-warning' : 'bg-primary'}`}
                    style={{ width: `${Math.max(2, share * 100)}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
