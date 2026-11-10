import { NavLink, Outlet } from 'react-router';
import { HealthPills } from '../operations/HealthPills.jsx';
import { Icon } from './Icon.jsx';

// Sidebar + top bar from the Stitch screens. The sidebar only has Apps for now;
// Incidents is a temporary P0 page that moves into each app's dashboard in P3.
const NAV = [
  { to: '/', label: 'Apps', icon: 'apps', end: true },
  { to: '/incidents', label: 'Incidents', icon: 'emergency_home' },
];

export function Layout() {
  return (
    <div className="flex min-h-full">
      <aside className="hidden w-56 shrink-0 border-r border-outline-variant bg-surface-container-low md:block">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="grid size-8 place-items-center rounded bg-primary-container text-on-primary-container">
            <Icon name="deployed_code" className="text-[20px]" />
          </span>
          <span className="text-headline-md font-semibold">Kairo</span>
        </div>
        <nav className="flex flex-col gap-1 px-2" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded px-3 py-2 text-body-lg ${
                  isActive
                    ? 'border-l-2 border-primary bg-surface-container-high text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`
              }
            >
              <Icon name={item.icon} className="text-[18px]" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-outline-variant px-4 py-3 md:px-6">
          <HealthPills />
          {/* mobile: no sidebar, so the nav moves up here */}
          <nav className="flex gap-3 md:hidden" aria-label="Main">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="text-body-md text-primary">
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
