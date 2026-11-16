import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { ReleaseTable } from '../../components/app/ReleaseTable.jsx';
import { Panel, PanelMessage } from '../../components/common/Panel.jsx';
import { usePoll } from '../../hooks/usePoll.js';
import { getAppReleases } from '../../services/api.js';

// Releases (mockup v2, FR-60, FR-61): newest first, with "Roll back to this"
// and each release's grace window and healthy mark (FR-72). Polls the list
// every 5 s; after a manual rollback the list and the header read again at once.
const POLL_MS = 5000;

export function ReleasesScreen() {
  const { app, now, refreshApp } = useOutletContext();
  const [refresh, setRefresh] = useState(0);
  const { data, error, loading } = usePoll(() => getAppReleases(app.slug), POLL_MS, [app.slug, refresh], `releases:${app.slug}`);
  const releases = data?.releases ?? [];

  function rolledBack() {
    setRefresh((n) => n + 1);
    refreshApp();
  }

  return (
    <Panel title="Releases" meta={data ? `${releases.length} of ${data.total} shown · last 3 images kept` : null}>
      {loading ? (
        <PanelMessage>Loading…</PanelMessage>
      ) : !data ? (
        <PanelMessage tone="bad">{error?.message ?? "Couldn't load the releases"}</PanelMessage>
      ) : releases.length ? (
        <ReleaseTable slug={app.slug} releases={releases} now={now} onRolledBack={rolledBack} />
      ) : (
        <PanelMessage>No releases yet. The first one is the preview.</PanelMessage>
      )}
    </Panel>
  );
}
