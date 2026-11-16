import { useOutletContext } from 'react-router';
import { KpiRow } from '../../components/app/KpiRow.jsx';
import { MetricCharts } from '../../components/app/MetricCharts.jsx';
import { usePoll } from '../../hooks/usePoll.js';
import { getAppMetrics } from '../../services/api.js';

// Metrics (mockup v2, FR-56): the six live numbers and both 30-minute charts,
// with Kairo's actions marked on them. Polls the metrics every 5 s.
const POLL_MS = 5000;

export function MetricsScreen() {
  const { app } = useOutletContext();
  const metrics = usePoll(() => getAppMetrics(app.slug), POLL_MS, [app.slug], `metrics:${app.slug}`);
  return (
    <>
      <KpiRow metrics={metrics.data} app={app} />
      <MetricCharts metrics={metrics.data} error={metrics.error} />
    </>
  );
}
