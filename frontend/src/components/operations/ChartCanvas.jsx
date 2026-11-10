import { useEffect, useRef } from 'react';
import { Chart } from './chart.setup.js';

// Thin React wrapper around a Chart.js chart. Creates it once, then updates
// data in place on every refresh so polling doesn't restart the animation.
// `label` describes the chart for screen readers.
export function ChartCanvas({ type, data, options, label, height = 220 }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    chartRef.current = new Chart(canvasRef.current, { type, data, options });
    return () => chartRef.current?.destroy();
    // created once per type; data changes go through the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data = data;
    chart.options = options;
    chart.update();
  }, [data, options]);

  return (
    <div style={{ height }} className="relative">
      <canvas ref={canvasRef} role="img" aria-label={label} />
    </div>
  );
}
