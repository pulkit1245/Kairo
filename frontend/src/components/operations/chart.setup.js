// Chart.js set-up, done once. Registering only what we use keeps the bundle
// small (Chart.js is tree-shakeable). Colors come from the theme tokens in
// styles/index.css so charts match the rest of the UI.
import {
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
    const panel = themeColor('surface-container-low') || 'transparent';
    const shown = items
      .map((m) => ({ ...m, px: scales.x.getPixelForValue(m.x) }))
      .filter((m) => m.px >= chartArea.left && m.px <= chartArea.right);

    // 1. every line first, so no line is drawn over a label placed before it
    ctx.setLineDash([3, 3]);
    for (const m of shown) {
      ctx.strokeStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(m.px, chartArea.top);
      ctx.lineTo(m.px, chartArea.bottom);
      ctx.stroke();
    }

    // 2. the labels, staggered: each goes on the first row where it overlaps
    // no other label (with a gap), so close markers step down instead of
    // running into each other
    const ROW = 14;
    const GAP = 6;
    const rows = [];
    for (const m of shown) {
      if (!m.label) continue;
      const w = ctx.measureText(m.label).width;
      // right of the line, or left of it near the right edge
      const left = m.px + 3 + w > chartArea.right - 4 ? m.px - 3 - w : m.px + 3;
      let row = rows.findIndex((boxes) => boxes.every(([a, b]) => left + w + GAP < a || left > b + GAP));
      if (row === -1) row = rows.push([]) - 1;
      rows[row].push([left, left + w]);
      const y = chartArea.top + 2 + row * ROW;
      // on the panel's colour, so the text reads over grid, limit and marker lines
      ctx.fillStyle = panel;
      ctx.fillRect(left - 2, y - 2, w + 4, ROW - 1);
      ctx.fillStyle = m.color;
      ctx.fillText(m.label, left, y);
    }
    ctx.restore();
  },
};

Chart.register(
  markers,
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
