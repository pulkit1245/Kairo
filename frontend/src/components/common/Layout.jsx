import { NavLink, Outlet } from 'react-router';
import { usePoll } from '../../hooks/usePoll.js';
import { listApps, logout } from '../../services/api.js';
import { useAuth } from '../auth/auth.jsx';
import { HealthPills } from '../operations/HealthPills.jsx';
import { Sidebar } from './Sidebar.jsx';

// Sidebar + top bar. The sidebar lists only real things (Sidebar.jsx); on a
// phone it is hidden and Apps moves into the top bar.
const NAV = [{ to: '/', label: 'Apps', end: true }];

// GET /api/apps is polled once here, every 5 s, for the sidebar and the Apps
// page (through the Outlet's context), so its Prometheus numbers aren't read twice
const POLL_MS = 5000;

export function Layout() {
  const apps = usePoll(listApps, POLL_MS);
  return (
    <div className="flex min-h-full">
      <Sidebar apps={apps} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-outline-variant px-4 py-3 md:px-6">
          <HealthPills />
          <div className="flex shrink-0 items-center gap-4">
            {/* mobile: no sidebar, so the nav moves up here */}
            <nav className="flex gap-3 md:hidden" aria-label="Main">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className="text-body-md text-primary">
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-6">
          <Outlet context={apps} />
        </main>
      </div>
    </div>
  );
}

// who is signed in, and sign out (FR-1)
function UserMenu() {
  const { user } = useAuth();

  async function signOut() {
    try {
      await logout();
    } finally {
      window.location.assign('/signin');
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden font-mono text-code-md text-on-surface-variant sm:inline">@{user.login}</span>
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" className="size-7 rounded-full border border-outline-variant" />
      ) : (
        <span className="grid size-7 place-items-center rounded-full bg-surface-container-high font-mono text-code-md uppercase">
          {user.login.slice(0, 1)}
        </span>
      )}
      <button type="button" onClick={signOut} className="whitespace-nowrap text-body-md text-on-surface-variant hover:text-on-surface">
        Sign out
      </button>
    </div>
  );
}
