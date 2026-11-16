// The app's screens (P5d, mockup v2): one address each, so links, Back and a
// page reload all work. The sidebar and the tab bar both list these.

export const SCREENS = [
  { key: 'overview', path: '', label: 'Overview', icon: 'dashboard' },
  { key: 'incidents', path: 'incidents', label: 'Incidents', icon: 'emergency_home' },
  { key: 'metrics', path: 'metrics', label: 'Metrics', icon: 'monitoring' },
  { key: 'logs', path: 'logs', label: 'Logs', icon: 'terminal' },
  { key: 'releases', path: 'releases', label: 'Releases', icon: 'history' },
  { key: 'test', path: 'test', label: 'Test panel', icon: 'science' },
];

/** /apps/<slug>, or /apps/<slug>/<screen> */
export const screenUrl = (slug, key = 'overview') => {
  const s = SCREENS.find((x) => x.key === key);
  return `/apps/${slug}${s?.path ? `/${s.path}` : ''}`;
};

/** /apps/<slug>/incidents/<id>: one incident's own page */
export const incidentUrl = (slug, id) => `/apps/${slug}/incidents/${id}`;

// The one-page dashboard's section links (#logs …) and the Apps list's old
// Logs button: each now has a screen of its own
export const HASH_SCREENS = {
  '#overview': 'overview',
  '#incidents': 'incidents',
  '#logs': 'logs',
  '#releases': 'releases',
  '#test-panel': 'test',
};

/** which screen a path under /apps/<slug> is, or null for one we don't have */
export function screenOf(pathname, slug) {
  const rest = pathname.slice(`/apps/${slug}`.length).replace(/^\/|\/$/g, '');
  const first = rest.split('/')[0];
  return SCREENS.find((s) => s.path === first)?.key ?? null;
}
