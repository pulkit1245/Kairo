import { useCallback, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { AppHeader } from '../../components/app/AppHeader.jsx';
import { AppTabs } from '../../components/app/AppTabs.jsx';
import { AttentionBanner } from '../../components/app/AttentionBanner.jsx';
import { DeleteAppDialog } from '../../components/app/DeleteAppDialog.jsx';
import { HASH_SCREENS, screenOf, screenUrl } from '../../components/app/screens.js';
import { Icon } from '../../components/common/Icon.jsx';
import { PanelMessage } from '../../components/common/Panel.jsx';
import { useNow } from '../../hooks/useNow.js';
import { usePoll } from '../../hooks/usePoll.js';
import { getApp } from '../../services/api.js';

// What every app screen shares (mockup v2): the way back to Apps, the header
// (in full on the Overview), the needs-attention banner and the tab bar. The
// screen itself is the Outlet; it gets { app, now, refreshApp } as its context
// and polls only what it shows. The app's own facts poll here, every 5 s
// (FR-56, FR-59): healing and rollouts change them in the background.
const POLL_MS = 5000;

// One app's screens, drawn fresh for each app: switching apps on the same
// screen drops everything the last one held on screen (older incident pages,
// paused logs, a rollback's message), not only its polled data (P5d)
export function AppScreensRoute() {
  const { slug } = useParams();
  return <AppScreens key={slug} />;
}

function AppScreens() {
  const { slug } = useParams();
  const { pathname, hash } = useLocation();
  // bumped after an action that changes the app (a manual rollback), to read it at once
  const [refresh, setRefresh] = useState(0);
  const refreshApp = useCallback(() => setRefresh((n) => n + 1), []);
  const { data: app, error, loading } = usePoll(() => getApp(slug), POLL_MS, [slug, refresh], `app:${slug}`);
  const [deleting, setDeleting] = useState(false);
  const closeDelete = useCallback(() => setDeleting(false), []);
  // ticks every second during a grace window or Send Traffic, for their countdowns
  const now = useNow((app?.release && !app.release.healthyAt) || app?.traffic?.running);

  // the one-page dashboard's #section links, and any saved copy of them
  if (hash in HASH_SCREENS) return <Navigate replace to={screenUrl(slug, HASH_SCREENS[hash])} />;

  if (loading) return <PanelMessage>Loading…</PanelMessage>;
  if (!app) return <PanelMessage tone="bad">{error?.message ?? 'Not found'}</PanelMessage>;

  const screen = screenOf(pathname, slug);
  return (
    <div className="flex flex-col gap-5">
      <Link to="/" className="inline-flex w-fit items-center gap-1 text-body-md text-on-surface-variant hover:text-on-surface">
        <Icon name="arrow_back" className="text-[16px]" /> Apps
      </Link>
      <AppHeader app={app} now={now} full={screen === 'overview'} onDelete={() => setDeleting(true)} />
      <AttentionBanner app={app} />
      <AppTabs app={app} current={screen} />
      <Outlet context={{ app, now, refreshApp }} />
      {deleting && <DeleteAppDialog app={app} onClose={closeDelete} />}
    </div>
  );
}
