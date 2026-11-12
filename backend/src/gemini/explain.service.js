import { createHash } from 'node:crypto';
import { askGemini } from './gemini.client.js';
import { redact } from './redact.service.js';

// Plain-English explanations of failures (FR-28, FR-53). Gemini only explains:
// the rule-based reason or cause is always stored too, and is what Kairo acts
// on (FR-54). Both functions return the text, or null when Gemini is off,
// failing or unsure. Logs are redacted by pattern before they leave (FR-53).

export const BUILD_LOG_LINES = 80; // FR-28
export const POD_LOG_LINES = 50; // FR-53
const MAX_CHARS = 600;

const SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string', description: 'The explanation, in plain words. "" if the logs do not show the cause.' },
  },
  required: ['explanation'],
};

const BUILD_INSTRUCTIONS = `You explain why a Docker image build failed, to a student who owns the repo.
Kairo generated the Dockerfile; the student can only change their repo.
In two or three short sentences: what failed, the likely cause in the repo, and what to change.
Name the file or package when the log shows it. Don't repeat the whole log. Don't invent details the log doesn't show.`;

const INCIDENT_INSTRUCTIONS = `You explain why a running app triggered an alert, to a student who owns the app.
Kairo runs it on Kubernetes with a 256 MiB memory limit and a 500m CPU limit, and has already reacted (restart, rollback or scale).
In one or two short sentences: what the logs show went wrong in the app, and what in the code would cause it.
If the logs don't show a cause, say what the alert means instead. Don't invent details.`;

/**
 * FR-28: why the build failed, from its last 80 log lines. Cached per commit
 * sha and log tail, so a retry of the same commit doesn't ask again.
 * @returns {Promise<string|null>}
 */
export async function explainBuildFailure({ commitSha, stack, reason, logTail }, ask = askGemini) {
  const tail = redact((logTail ?? []).slice(-BUILD_LOG_LINES).join('\n'));
  if (!tail.trim()) return null;
  const input = [
    `Stack: ${stack ?? 'unknown (the repo has its own Dockerfile)'}`,
    `Kairo's reason: ${redact(reason)}`,
    `Last ${BUILD_LOG_LINES} lines of the build log:\n${tail}`,
  ].join('\n\n');
  const digest = createHash('sha256').update(tail).digest('hex').slice(0, 16);
  const answer = await ask({
    purpose: `build explanation for ${commitSha.slice(0, 7)}`,
    instructions: BUILD_INSTRUCTIONS,
    input,
    schema: SCHEMA,
    cache: { commitSha, question: `build:v1:${digest}` },
  });
  return clean(answer?.data?.explanation);
}

/**
 * FR-53: why an incident happened, from the alert and the pod's last 50 log
 * lines (redacted). Not cached: every incident's logs differ.
 * @param {{ alertName: string, cause: string, logs: string|null, previous?: boolean, pod?: string|null }} incident
 * @returns {Promise<string|null>}
 */
export async function explainIncident({ alertName, cause, logs, previous = false, pod = null }, ask = askGemini) {
  const lines = redact((logs ?? '').split('\n').filter(Boolean).slice(-POD_LOG_LINES).join('\n'));
  const input = [
    `Alert: ${alertName}`,
    `Kairo's rule-based cause: ${cause}`,
    lines
      ? `Last ${POD_LOG_LINES} log lines of ${pod ?? 'the pod'}${previous ? ' (from the run that ended)' : ''}:\n${lines}`
      : 'No pod logs could be read.',
  ].join('\n\n');
  const answer = await ask({
    purpose: `${alertName} explanation`,
    instructions: INCIDENT_INSTRUCTIONS,
    input,
    schema: SCHEMA,
  });
  return clean(answer?.data?.explanation);
}

function clean(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS - 1).trimEnd()}…` : t;
}
