import { useEffect, useState } from 'react';

// The time, ticking every second while `ticking` (countdowns: a grace window,
// Send Traffic); otherwise it changes only when the component draws again.
export function useNow(ticking) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}
