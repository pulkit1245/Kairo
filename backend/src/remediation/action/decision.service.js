// Alert names here MUST match the alert rules we generate for Prometheus
// (templates/prometheus, phase 2). Keep the two lists in sync.

const RULES = {
  // liveness keeps failing / pod not ready -> kill it and let the ReplicaSet make a new one
  KairoAppDown: { action: 'RESTART', cause: 'App stopped responding to health checks' },
  KairoOOMKilled: { action: 'RESTART', cause: 'Container went over its memory limit' },

  // restarting a crashlooping pod won't fix a bad build, go back to the last good one
  KairoCrashLoop: { action: 'ROLLBACK', cause: 'Container keeps crashing on startup' },

  KairoHighCpu: { action: 'SCALE', cause: 'CPU usage is high' },
  KairoHighLatency: { action: 'SCALE', cause: 'Response times are high' },
};

export function decideAction(alertName, summary) {
  const rule = RULES[alertName];
  if (rule) return rule;

  // unknown alert - still record it so it shows up on the dashboard,
  // just don't touch anything
  return { action: 'NONE', cause: summary || alertName };
}
