import { useMemo } from 'react';
import { shortTime } from '../common/format.js';
import { ChartCanvas } from './ChartCanvas.jsx';
import { themeColor } from './chart.setup.js';

// Recovery time of each resolved incident, oldest to newest. The number the
// demo is about (PRD section 9), so it gets the first chart.
export function RecoveryChart({ incidents }) {
  const resolved = useMemo(
    () =>
      incidents
        .filter((i) => i.recoverySeconds !== null)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .slice(-20),
    [incidents],
  );

  const data = useMemo(
    () => ({
      labels: resolved.map((i) => `${i.appName} ${shortTime(i.startedAt)}`),
      datasets: [
        {
          label: 'Recovery (s)',
          data: resolved.map((i) => i.recoverySeconds),
          backgroundColor: themeColor('primary-container'),
          borderRadius: 2,
          maxBarThickness: 32,
        },
      ],
    }),
    [resolved],
  );

  const options = useMemo(
    () => ({
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, title: { display: true, text: 'seconds' } },
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: (items) => resolved[items[0].dataIndex]?.alertName ?? '',
            label: (item) => `${resolved[item.dataIndex].appName}: recovered in ${item.raw} s`,
          },
        },
      },
    }),
    [resolved],
  );

  if (resolved.length === 0) {
    return <p className="py-10 text-center text-on-surface-variant">No resolved incidents yet.</p>;
  }

  return (
    <ChartCanvas
      type="bar"
      data={data}
      options={options}
      label={`Recovery time in seconds for the last ${resolved.length} resolved incidents`}
    />
  );
}
