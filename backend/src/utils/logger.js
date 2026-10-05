const weight = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel() {
  const fromEnv = process.env.LOG_LEVEL;
  return fromEnv && fromEnv in weight ? fromEnv : 'info';
}

function write(level, scope, msg, extra) {
  if (weight[level] < weight[minLevel()]) return;

  const time = new Date().toISOString().slice(11, 19);
  const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;

  if (extra === undefined) out(line);
  else out(line, extra);
}

export function createLogger(scope) {
  return {
    debug: (msg, extra) => write('debug', scope, msg, extra),
    info: (msg, extra) => write('info', scope, msg, extra),
    warn: (msg, extra) => write('warn', scope, msg, extra),
    error: (msg, extra) => write('error', scope, msg, extra),
  };
}
