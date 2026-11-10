// The one place the frontend talks to the backend. Vite proxies /api to
// localhost:4000 in development (vite.config.js).
// Errors come back as { error: "<message>" } (architecture section 6).

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

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
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return body;
}

/** @returns {Promise<{ ok: boolean, db: 'up'|'down', cluster: 'up'|'down' }>} */
export const getHealth = () => request('/health');

// a "deployment" is one pipeline run (see backend/src/types/deployment.types.js)
export const listDeployments = () => request('/deployments');
export const createDeployment = (repoUrl) =>
  request('/deployments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoUrl }),
  });
export const getDeployment = (id) => request(`/deployments/${encodeURIComponent(id)}`);

export const listIncidents = () => request('/incidents');
