import { useEffect, useRef, useState } from 'react';

// Calls `load` now and then every `interval` ms, and keeps the last result.
// `interval` can also be a function of the latest data that returns ms, or
// null to stop polling (e.g. once a pipeline run has finished).
// A slow request never overlaps the next one, and the timer stops when the
// component goes away. The last good data stays on screen if a refresh fails.
//
// `cacheKey` (P5d): names what is loaded, e.g. `releases:<slug>` or
// `incident:<id>`, so it must change whenever `load` would load something
// else. The last result is kept under it for this tab, and a screen opened
// again starts from it while the first request runs: Back redraws at once and
// the browser can put the scroll back. Data belongs to its key: when the key
// changes (another app, another incident) the old data is never returned, not
// even for one render; the new key's cached result or nothing (loading) is.
const cache = new Map();
const CACHE_MAX = 40;

function remember(key, data) {
  cache.delete(key);
  cache.set(key, data);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

const fresh = (key) => {
  const cached = key ? cache.get(key) : undefined;
  return cached === undefined
    ? { key, data: null, error: null, loading: true }
    : { key, data: cached, error: null, loading: false };
};

export function usePoll(load, interval, deps = [], cacheKey = null) {
  const [state, setState] = useState(() => fresh(cacheKey));
  const loadRef = useRef(load);
  loadRef.current = load;
  const intervalRef = useRef(interval);
  intervalRef.current = interval;

  useEffect(() => {
    let stopped = false;
    let timer;
    if (cacheKey) setState((s) => (s.key === cacheKey ? s : fresh(cacheKey)));
    else setState((s) => ({ ...s, loading: s.data === null }));

    async function tick() {
      let data = null;
      try {
        data = await loadRef.current();
        if (!stopped) {
          if (cacheKey) remember(cacheKey, data);
          setState({ key: cacheKey, data, error: null, loading: false });
        }
      } catch (error) {
        if (!stopped) setState((s) => (s.key === cacheKey ? { ...s, error, loading: false } : { key: cacheKey, data: null, error, loading: false }));
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

  // the render right after the key changed, before the effect above ran
  if (cacheKey && state.key !== cacheKey) return fresh(cacheKey);
  return state;
}
