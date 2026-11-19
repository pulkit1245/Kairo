import { Link } from 'react-router';
import { Icon } from '../common/Icon.jsx';
import { SCREENS, screenUrl } from './screens.js';

// The app's tab bar (mockup v2): one tab per screen, the open-incident count
// on Incidents. On a phone it scrolls sideways inside itself.
export function AppTabs({ app, current }) {
  return (
    <nav className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0" aria-label="App screens">
      <ul className="flex min-w-max gap-1 border-b border-outline-variant">
        {SCREENS.map((s) => {
          const on = s.key === current;
          return (
            <li key={s.key}>
              <Link
                to={screenUrl(app.slug, s.key)}
                aria-current={on ? 'page' : undefined}
                className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-body-lg ${
                  on ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Icon name={s.icon} className="text-[17px]" /> {s.label}
                {s.key === 'incidents' && app.openIncidents > 0 && (
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
    </nav>
  );
}
