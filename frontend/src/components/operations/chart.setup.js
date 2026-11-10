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

Chart.register(
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
