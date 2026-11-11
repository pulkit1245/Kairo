import { useState } from 'react';
import { setAutoHeal } from '../../services/api.js';

// The auto-heal switch in the app header (FR-51, FR-59). The change shows at
// once; if the backend refuses it, the switch goes back and says why.
export function AutoHealToggle({ app }) {
  const [pending, setPending] = useState(null); // the value being saved
  const [error, setError] = useState(null);
  const on = pending ?? app.autoHeal;

  async function toggle() {
    const next = !on;
    setPending(next);
    setError(null);
    try {
      await setAutoHeal(app.slug, next);
    } catch (err) {
      setError(err.message);
    } finally {
      // the page's next poll brings the saved value
      setTimeout(() => setPending(null), 5000);
    }
  }

  return (
    <span className="inline-flex items-center gap-2 font-mono text-code-sm">
      <span className="uppercase tracking-wider text-on-surface-variant" id={`autoheal-${app.slug}`}>
        Auto-heal:
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`autoheal-${app.slug}`}
        onClick={toggle}
        className={`relative h-6 w-11 rounded-full border transition-colors ${on ? 'border-tertiary bg-tertiary/80' : 'border-outline-variant bg-surface-container-highest'}`}
      >
        <span className={`absolute top-0.5 size-[18px] rounded-full bg-surface transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
      <span className={on ? 'font-bold text-tertiary' : 'font-bold text-warning'}>{on ? 'ON' : 'OFF: Kairo only records'}</span>
      {error && <span className="text-error">{error}</span>}
    </span>
  );
}
