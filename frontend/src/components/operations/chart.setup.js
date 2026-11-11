// Chart.js set-up, done once. Registering only what we use keeps the bundle
// small (Chart.js is tree-shakeable). Colors come from the theme tokens in
// styles/index.css so charts match the rest of the UI.
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';

// Vertical marker lines with a small label, e.g. "Scale up 14:27", from
// options.plugins.markers.items = [{ x, label, color }]. Written here instead
// of adding chartjs-plugin-annotation for one feature.
const markers = {
  id: 'markers',
  afterDatasetsDraw(chart, _args, opts) {
    const items = opts?.items ?? [];
    const { ctx, chartArea, scales } = chart;
    if (!items.length || !scales.x) return;
    ctx.save();
    ctx.font = "10px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textBaseline = 'top';
    let lastLabelEnd = -Infinity;
    let row = 0;
    for (const m of items) {
      const x = scales.x.getPixelForValue(m.x);
      if (x < chartArea.left || x > chartArea.right) continue;
      ctx.strokeStyle = m.color;
      ctx.fillStyle = m.color;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      if (m.label) {
        const w = ctx.measureText(m.label).width;
        // labels that would overlap go one row down
        row = x - 2 < lastLabelEnd ? row + 1 : 0;
        const left = Math.min(x + 3, chartArea.right - w);
        ctx.fillText(m.label, left, chartArea.top + 2 + row * 12);
        lastLabelEnd = left + w;
      }
    }
    ctx.restore();
  },
};

Chart.register(
  markers,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  Filler,
  CategoryScale,
  LinearScale,
  Tooltip,
);

export function themeColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
}

export function applyChartDefaults() {
  Chart.defaults.color = themeColor('on-surface-variant');
  Chart.defaults.borderColor = themeColor('outline-variant');
  Chart.defaults.font.family = "'JetBrains Mono', ui-monospace, monospace";
  Chart.defaults.font.size = 11;
  Chart.defaults.animation = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? false
    : { duration: 300 };
  Chart.defaults.plugins.tooltip.backgroundColor = themeColor('surface-container-highest');
  Chart.defaults.plugins.tooltip.titleColor = themeColor('on-surface');
  Chart.defaults.plugins.tooltip.bodyColor = themeColor('on-surface');
}

export { Chart };
