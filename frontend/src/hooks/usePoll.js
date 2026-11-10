import { useEffect, useRef, useState } from 'react';

// Calls `load` now and then every `intervalMs`, and keeps the last result.
// A slow request never overlaps the next one, and the timer stops when the
// component goes away. The last good data stays on screen if a refresh fails.
export function usePoll(load, intervalMs) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let stopped = false;
    let timer;

    async function tick() {
      try {
        const data = await loadRef.current();
        if (!stopped) setState({ data, error: null, loading: false });
      } catch (error) {
        if (!stopped) setState((s) => ({ data: s.data, error, loading: false }));
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }

    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [intervalMs]);

  return state;
}
