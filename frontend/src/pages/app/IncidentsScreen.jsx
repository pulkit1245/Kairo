import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import { AppIncidents } from '../../components/app/AppIncidents.jsx';
import { IncidentDrawer } from '../../components/app/IncidentDrawer.jsx';
import { usePoll } from '../../hooks/usePoll.js';
import { getAppIncidents } from '../../services/api.js';

// Incidents (mockup v2): the app's incidents, newest first, with filters.
// The newest page (25) polls every 5 s; "Show older" adds 25 at a time, which
// don't change once resolved, so they are loaded once.
const POLL_MS = 5000;

export function IncidentsScreen() {
  const { app } = useOutletContext();
  const first = usePoll(() => getAppIncidents(app.slug), POLL_MS, [app.slug], `incidents:${app.slug}`);
  const [older, setOlder] = useState({ incidents: [], more: null, busy: false, error: null });
  const [openIncident, setOpenIncident] = useState(null);
  const closeIncident = useCallback(() => setOpenIncident(null), []);
  useEffect(() => setOlder({ incidents: [], more: null, busy: false, error: null }), [app.slug]);

  // the newest page can gain incidents while older pages are shown: no doubles
  const seen = new Set();
  const incidents = [...(first.data?.incidents ?? []), ...older.incidents].filter((i) => !seen.has(i.id) && seen.add(i.id));
  const more = older.more ?? first.data?.more ?? false;

  async function showOlder() {
    setOlder((o) => ({ ...o, busy: true, error: null }));
    try {
      const page = await getAppIncidents(app.slug, { before: incidents.at(-1).id });
      setOlder((o) => ({ incidents: [...o.incidents, ...page.incidents], more: page.more, busy: false, error: null }));
    } catch (err) {
      setOlder((o) => ({ ...o, busy: false, error: err.message }));
    }
  }

  return (
    <>
      <AppIncidents
        incidents={incidents}
        loading={first.loading}
        onOpen={setOpenIncident}
        footer={
          (more || older.error) && (
            <div className="flex flex-wrap items-center gap-3 border-t border-outline-variant px-4 py-2.5 font-mono text-code-sm">
              {more && (
                <button type="button" onClick={showOlder} disabled={older.busy} className="text-primary hover:underline disabled:opacity-50">
                  {older.busy ? 'Loading…' : 'Show older →'}
                </button>
              )}
              {older.error && <span className="text-error">{older.error}</span>}
            </div>
          )
        }
      />
      {first.error && !first.data && <p className="text-body-md text-error">{first.error.message}</p>}
      {openIncident && <IncidentDrawer id={openIncident} onClose={closeIncident} />}
    </>
  );
}
