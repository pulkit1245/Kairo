import { useOutletContext } from 'react-router';
import { LogsPanel } from '../../components/app/LogsPanel.jsx';

// Logs (mockup v2, FR-58): the newest pod's last 50 lines, every 5 s, until paused.
export function LogsScreen() {
  const { app } = useOutletContext();
  return <LogsPanel slug={app.slug} />;
}
