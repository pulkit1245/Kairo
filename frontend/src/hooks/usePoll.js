import { useEffect, useRef, useState } from 'react';

// Calls `load` now and then every `interval` ms, and keeps the last result.
// `interval` can also be a function of the latest data that returns ms, or
// null to stop polling (e.g. once a pipeline run has finished).
// A slow request never overlaps the next one, and the timer stops when the
// component goes away. The last good data stays on screen if a refresh fails.
export function usePoll(load, interval, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const loadRef = useRef(load);
  loadRef.current = load;
  const intervalRef = useRef(interval);
  intervalRef.current = interval;

  useEffect(() => {
    let stopped = false;
    let timer;
    setState((s) => ({ ...s, loading: s.data === null }));

    async function tick() {
      let data = null;
      try {
        data = await loadRef.current();
        if (!stopped) setState({ data, error: null, loading: false });
      } catch (error) {
        if (!stopped) setState((s) => ({ data: s.data, error, loading: false }));
      }
      const next = typeof intervalRef.current === 'function' ? intervalRef.current(data) : intervalRef.current;
      if (!stopped && next) timer = setTimeout(tick, next);
    }

    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
