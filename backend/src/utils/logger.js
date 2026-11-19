import { inspect } from 'node:util';
import { redact } from '../gemini/redact.service.js';

const weight = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel() {
  const fromEnv = process.env.LOG_LEVEL;
  return fromEnv && fromEnv in weight ? fromEnv : 'info';
}

// PRD section 9: no token or key ever reaches a log. Every line, and every
// error or object logged with it, goes through two filters before it is
// written:
//   - redact(): anything shaped like a secret (GitHub tokens, Google keys,
//     private key blocks, Bearer headers, user:password@ in URLs, name=value
//     where the name sounds secret), the same patterns Gemini input gets
//   - the actual values of Kairo's own secrets, whatever they look like
// Errors are printed as text (their stack and properties), not handed to
// the console as objects, so nothing inside them escapes the filters.
const SECRET_VARS = ['GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'GEMINI_API_KEY', 'ALERT_WEBHOOK_TOKEN'];
const R = '[redacted]';

function knownSecrets() {
  const values = SECRET_VARS.map((name) => process.env[name]);
  // the database password, if the URL has one
  try {
    const db = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
    if (db?.password) values.push(decodeURIComponent(db.password), db.password);
  } catch {
    // not a URL: nothing to take from it
  }
  // short values would match ordinary words; real secrets are long
  return values.filter((v) => typeof v === 'string' && v.length >= 8);
}

export function scrub(text) {
  let out = redact(String(text));
  for (const secret of knownSecrets()) out = out.split(secret).join(R);
  return out;
}

function write(level, scope, msg, extra) {
  if (weight[level] < weight[minLevel()]) return;

  const time = new Date().toISOString().slice(11, 19);
  const line = scrub(`${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`);
  const out = level === 'error' || level === 'warn' ? console.error : console.log;

  if (extra === undefined) out(line);
  else out(line, scrub(typeof extra === 'string' ? extra : inspect(extra, { depth: 4, breakLength: 120 })));
}

export function createLogger(scope) {
  return {
    debug: (msg, extra) => write('debug', scope, msg, extra),
    info: (msg, extra) => write('info', scope, msg, extra),
    warn: (msg, extra) => write('warn', scope, msg, extra),
    error: (msg, extra) => write('error', scope, msg, extra),
  };
}
