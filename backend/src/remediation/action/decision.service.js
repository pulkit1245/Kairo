// FR-54: every alert gets a plain cause from a rule, so nothing depends on
// Gemini (P4 only adds an explanation). The cause says what happened, not
// what Kairo did: that's in the attempts, and Kairo may not act at all
// (auto-heal off, give-up). Alert names here MUST match the generated
// Prometheus rules (templates/prometheus). Keep the two lists in sync.

export const RULES = {
  // liveness keeps failing / pod not ready -> kill it and let the ReplicaSet make a new one
  KairoAppDown: { action: 'RESTART', cause: 'The app stopped answering its health check for a minute' },
  KairoOOMKilled: { action: 'RESTART', cause: 'The app ran out of memory (over its 256 MiB limit) and was killed' },

  // restarting a crashlooping pod won't fix a bad build, go back to the last good one
  KairoCrashLoop: { action: 'ROLLBACK', cause: 'The app keeps crashing as soon as it starts' },

  // SCALE_DOWN never comes from an alert: the scale-down check (P3) triggers it

  KairoHighCpu: { action: 'SCALE_UP', cause: 'A pod used over 80% of its CPU limit for a minute' },
  KairoHighLatency: { action: 'SCALE_UP', cause: 'Responses took over a second (p95) for two minutes' },
};

export function decideAction(alertName, summary) {
  const rule = RULES[alertName];
  if (rule) return rule;

  // unknown alert - still record it so it shows up on the dashboard,
  // just don't touch anything
  return { action: 'NONE', cause: summary || alertName };
}
