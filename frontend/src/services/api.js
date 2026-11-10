// The one place the frontend talks to the backend. Vite proxies /api to
// localhost:4000 in development (vite.config.js).
// Errors come back as { error: "<message>" } (architecture section 6).

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// pages anyone may see; a 401 anywhere else means the session ended
const PUBLIC_PATHS = ['/signin', '/not-invited'];

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      ...options,
      headers: { accept: 'application/json', ...options.headers },
    });
  } catch {
    // fetch only throws when nothing answered at all
    throw new ApiError('The Kairo API is not reachable', 0);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // in development Vite's proxy answers 502/504 with no JSON when the backend is down
    if (!body && [502, 503, 504].includes(res.status)) {
      throw new ApiError('The Kairo API is not reachable', res.status);
    }
    // signed out or the session expired (FR-42): back to the sign-in screen.
    // /auth/me is how the app asks "am I signed in?", so it handles 401 itself
    if (res.status === 401 && path !== '/auth/me' && !PUBLIC_PATHS.includes(window.location.pathname)) {
      window.location.assign('/signin');
    }
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return body;
}

const postJson = (path, data) =>
  request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

// sign-in (FR-1). Signing in and installing the App are full-page redirects to
// /api/auth/login and /api/auth/install, not fetch calls
/** @returns {Promise<{ login: string, avatarUrl: string|null, installUrl: string, installations: { id: string, accountLogin: string }[] }>} */
export const getMe = () => request('/auth/me');
export const logout = () => postJson('/auth/logout');

// the repo picker (FR-3, FR-6)
export const listRepos = () => request('/repos');
export const onboardRepo = (repoFullName) => postJson('/apps', { repoFullName });
// Try again when the setup PR couldn't be opened (AQ11)
export const retryPr = (slug) => postJson(`/apps/${encodeURIComponent(slug)}/pr`);

/** @returns {Promise<{ ok: boolean, db: 'up'|'down', cluster: 'up'|'down' }>} */
export const getHealth = () => request('/health');

// a "deployment" is one pipeline run (see backend/src/types/deployment.types.js)
export const listDeployments = () => request('/deployments');
// the P1 repo-URL shortcut, kept for testing and hidden from the UI (AQ10).
// Only Retry uses it, for runs that were started that way
export const createDeployment = (repoUrl) => postJson('/deployments', { repoUrl });
export const getDeployment = (id) => request(`/deployments/${encodeURIComponent(id)}`);

export const listIncidents = () => request('/incidents');
