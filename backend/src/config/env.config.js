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
};
