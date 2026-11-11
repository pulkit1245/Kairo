import os from 'node:os';
import path from 'node:path';

// node >= 20.12 can read .env on its own, no need for dotenv
try {
  process.loadEnvFile();
} catch {
  // no .env file - fine in CI / docker where vars come from outside
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export const env = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl: required('DATABASE_URL'),
  workspaceDir: process.env.WORKSPACE_DIR || path.join(os.tmpdir(), 'kairo-workspace'),
  cloneTimeoutMs: Number(process.env.CLONE_TIMEOUT_MS) || 60_000,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  remediationDryRun: bool('REMEDIATION_DRY_RUN', true),
  // shared with Alertmanager (FR-45). Never logged
  alertWebhookToken: process.env.ALERT_WEBHOOK_TOKEN || null,

  // where the browser reaches Kairo. GitHub sends people back to
  // <appUrl>/api/auth/callback, which Vite proxies to the backend
  appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),

  // the Kairo GitHub App (FR-1, FR-4). The client secret and the private key
  // are secrets: read here, used by src/github/, never logged
  github: {
    appId: process.env.GITHUB_APP_ID || null,
    appSlug: process.env.GITHUB_APP_SLUG || null,
    clientId: process.env.GITHUB_CLIENT_ID || null,
    clientSecret: process.env.GITHUB_CLIENT_SECRET || null,
    privateKeyPath: expandHome(process.env.GITHUB_APP_PRIVATE_KEY_PATH || '~/.kairo/kairo-github-app.pem'),
  },

  // Prometheus through the local port-forward (FR-57): only the backend queries it
  prometheusUrl: (process.env.PROMETHEUS_URL || 'http://localhost:9090').replace(/\/$/, ''),
  // Traefik's LoadBalancer on localhost, for Send Traffic (FR-62)
  traefikUrl: (process.env.TRAEFIK_URL || 'http://localhost').replace(/\/$/, ''),
  // FR-40: a Cloudflare quick tunnel per running app, to traefikUrl
  tunnelsEnabled: bool('TUNNELS_ENABLED', true),
  cloudflaredPath: process.env.CLOUDFLARED_PATH || 'cloudflared',

  // signs the session cookie. Without it nobody can sign in (FR-42)
  sessionSecret: process.env.SESSION_SECRET || null,
  // FR-2: GitHub logins that may sign in, comma separated, case doesn't matter
  allowedLogins: new Set(
    (process.env.ALLOWED_GITHUB_LOGINS || '')
      .split(',')
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean),
  ),
};

export const githubConfigured = () =>
  Boolean(env.github.appId && env.github.appSlug && env.github.clientId && env.github.clientSecret);

function expandHome(p) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}
