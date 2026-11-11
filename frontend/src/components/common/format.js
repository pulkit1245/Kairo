// Small display helpers shared by the tables.

export const shortSha = (sha) => (sha ? sha.slice(0, 7) : '—');

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return '—';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function duration(fromIso, toIso) {
  if (!fromIso || !toIso) return '—';
  const s = (new Date(toIso) - new Date(fromIso)) / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

// "owner/repo" from https://github.com/owner/repo.git
export const repoName = (url) => url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

export const shortTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// clock times in UTC, as on the Stitch screens: "14:20" or "14:20:12"
export function utcClock(msOrIso, seconds = false) {
  const d = new Date(msOrIso);
  const pad = (n) => String(n).padStart(2, '0');
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return seconds ? `${hm}:${pad(d.getUTCSeconds())}` : hm;
}

// "14:20:12 UTC", or "Yesterday 18:32:00 UTC", or "10 Nov 18:32:00 UTC"
export function utcStamp(iso, now = Date.now()) {
  const d = new Date(iso);
  const day = (t) => Math.floor(t / 86_400_000);
  const diff = day(now) - day(d.getTime());
  const prefix =
    diff === 0 ? '' : diff === 1 ? 'Yesterday ' : `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} `;
  return `${prefix}${utcClock(d, true)} UTC`;
}

