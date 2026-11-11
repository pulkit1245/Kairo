import { useMemo } from 'react';
import { utcClock } from '../common/format.js';
import { ChartCanvas } from '../operations/ChartCanvas.jsx';
import { themeColor } from '../operations/chart.setup.js';
import { actionText } from './incident.text.js';

// The two charts of the app page (FR-56, Stitch 07): traffic and error rate,
// CPU and memory, over the last 30 minutes. Kairo's actions in that window
// are drawn as dashed lines, so a scale-up shows up right where the load is.

const MiB = 1024 * 1024;
const points = (series, f = (v) => v) => (series ?? []).map(([t, v]) => ({ x: t * 1000, y: v === null ? null : f(v) }));

// Kairo's actions in the window, as markers
function actionMarkers(incidents, win) {
  const from = win.startSec * 1000;
  return incidents
    .flatMap((i) => i.attempts.filter((a) => a.result !== 'SKIPPED').map((a) => ({ a, t: Date.parse(a.attemptedAt) })))
    .filter(({ t }) => t >= from)
    .sort((x, y) => x.t - y.t)
    .map(({ a, t }) => ({
      x: t,
      label: `${actionText(a).split(' to ')[0]} ${utcClock(t)}`,
      color: themeColor(a.result === 'VERIFIED' ? 'tertiary' : a.result === 'APPLIED' ? 'primary' : 'error'),
    }));
}

function baseOptions(win, markers) {
  return {
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    elements: { point: { radius: 0, hoverRadius: 3 }, line: { borderWidth: 2, tension: 0.2 } },
    scales: {
      x: {
        type: 'linear',
        min: win.startSec * 1000,
        max: win.endSec * 1000,
        grid: { display: false },
        ticks: { stepSize: 5 * 60_000, callback: (v) => utcClock(v), maxRotation: 0 },
      },
    },
    plugins: {
      tooltip: { callbacks: { title: (items) => `${utcClock(items[0].parsed.x, true)} UTC` } },
      markers: { items: markers },
    },
  };
}

function Legend({ items }) {
  return (
    <ul className="flex flex-wrap gap-3 font-mono text-code-sm">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-0.5 w-3" style={{ background: i.color, borderTop: i.dashed ? `1px dashed ${i.color}` : undefined }} aria-hidden="true" />
          <span style={{ color: i.color }}>{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

function ChartBox({ title, legend, children }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded border border-outline-variant bg-surface-container-low px-4 py-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-code-md text-on-surface">{title}</h2>
        <Legend items={legend} />
      </header>
      {children}
    </section>
  );
}

export function MetricCharts({ metrics, incidents, error }) {
  const win = metrics?.window;
  const colors = useMemo(
    () => ({ traffic: themeColor('secondary'), errors: themeColor('error'), cpu: themeColor('tertiary'), memory: themeColor('primary'), limit: themeColor('error') }),
    [],
  );

  const markers = useMemo(() => (win ? actionMarkers(incidents, win) : []), [incidents, win]);

  const traffic = useMemo(() => {
    if (!metrics) return null;
    const options = baseOptions(metrics.window, markers);
    options.scales.y = { beginAtZero: true, suggestedMax: 5, title: { display: true, text: 'req/s' } };
    options.scales.y1 = {
      position: 'right',
      beginAtZero: true,
      suggestedMax: 5,
      grid: { display: false },
      title: { display: true, text: '5xx %' },
    };
    return {
      data: {
        datasets: [
          { label: 'Traffic (req/s)', data: points(metrics.series.rps), borderColor: colors.traffic, yAxisID: 'y' },
          { label: 'Error rate (%)', data: points(metrics.series.errorRate, (v) => v * 100), borderColor: colors.errors, yAxisID: 'y1' },
        ],
      },
      options,
    };
  }, [metrics, markers, colors]);

  const resources = useMemo(() => {
    if (!metrics) return null;
    const options = baseOptions(metrics.window, markers);
    const limitMiB = metrics.limits.memoryBytesPerPod / MiB;
    options.scales.y = { beginAtZero: true, suggestedMax: 100, title: { display: true, text: 'CPU m' } };
    options.scales.y1 = {
      position: 'right',
      beginAtZero: true,
      max: Math.ceil((limitMiB * 1.1) / 32) * 32,
      grid: { display: false },
      title: { display: true, text: 'MiB' },
    };
    const { startSec, endSec } = metrics.window;
    return {
      data: {
        datasets: [
          { label: 'CPU (m, all pods)', data: points(metrics.series.cpu, (v) => v * 1000), borderColor: colors.cpu, yAxisID: 'y' },
          { label: 'Memory (MiB, largest pod)', data: points(metrics.series.memory, (v) => v / MiB), borderColor: colors.memory, yAxisID: 'y1' },
          {
            label: `Memory limit (${limitMiB} MiB)`,
            data: [
              { x: startSec * 1000, y: limitMiB },
              { x: endSec * 1000, y: limitMiB },
            ],
            borderColor: colors.limit,
            borderWidth: 1,
            borderDash: [4, 4],
            yAxisID: 'y1',
          },
        ],
      },
      options,
    };
  }, [metrics, markers, colors]);

  const empty = (
    <p className="grid h-[220px] place-items-center text-center text-body-md text-on-surface-variant">
      {error ? error.message : 'Loading…'}
    </p>
  );

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartBox
        title="Traffic & error rate · last 30 min"
        legend={[
          { label: 'Traffic', color: colors.traffic },
          { label: '5xx %', color: colors.errors },
        ]}
      >
        {traffic ? (
          <ChartCanvas type="line" data={traffic.data} options={traffic.options} label="Requests per second and error rate over the last 30 minutes" />
        ) : (
          empty
        )}
      </ChartBox>
      <ChartBox
        title="CPU & memory · last 30 min"
        legend={[
          { label: 'CPU', color: colors.cpu },
          { label: 'Memory', color: colors.memory },
          { label: 'Limit', color: colors.limit, dashed: true },
        ]}
      >
        {resources ? (
          <ChartCanvas type="line" data={resources.data} options={resources.options} label="CPU and memory over the last 30 minutes" />
        ) : (
          empty
        )}
      </ChartBox>
    </div>
  );
}
