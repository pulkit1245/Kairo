import { useEffect, useRef, useState } from 'react';

// Calls `load` now and then every `interval` ms, and keeps the last result.
// `interval` can also be a function of the latest data that returns ms, or
// null to stop polling (e.g. once a pipeline run has finished).
// A slow request never overlaps the next one, and the timer stops when the
// component goes away. The last good data stays on screen if a refresh fails.
//
// `cacheKey` (P5d): the last result is kept under it for this tab, and a
// screen opened again starts from it while the first request runs. So Back
// redraws a screen at once and the browser can put the scroll back where it
// was, instead of drawing "Loading…" first.
const cache = new Map();
const CACHE_MAX = 40;

function remember(key, data) {
  cache.delete(key);
  cache.set(key, data);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

export function usePoll(load, interval, deps = [], cacheKey = null) {
  const [state, setState] = useState(() => {
    const cached = cacheKey ? cache.get(cacheKey) : undefined;
    return cached === undefined ? { data: null, error: null, loading: true } : { data: cached, error: null, loading: false };
  });
  const loadRef = useRef(load);
  loadRef.current = load;
  const intervalRef = useRef(interval);
  intervalRef.current = interval;

  useEffect(() => {
    let stopped = false;
    let timer;
    const cached = cacheKey ? cache.get(cacheKey) : undefined;
    if (cached !== undefined) setState({ data: cached, error: null, loading: false });
    else setState((s) => ({ ...s, loading: s.data === null }));

    async function tick() {
      let data = null;
      try {
        data = await loadRef.current();
        if (!stopped) {
          if (cacheKey) remember(cacheKey, data);
          setState({ data, error: null, loading: false });
        }
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
  }, [...deps, cacheKey]);

  return state;
}
