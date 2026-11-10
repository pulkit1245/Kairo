import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { applyChartDefaults } from './components/operations/chart.setup.js';
import './styles/index.css';

// after the stylesheet, so the theme colors are there to read
applyChartDefaults();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
