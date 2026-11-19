// PRD section 9: the success metrics Kairo's own record can prove, read from
// the database, Prometheus and GitHub's public API. Prints one line per metric
// with its value, its target, and where the number came from. Read-only: it
// changes nothing anywhere.
//
//   node scripts/metrics.mjs           (from backend/, with the backend's .env)
//   node scripts/metrics.mjs --json    the same as JSON
//
// Metrics the record can't prove (Postgres stopped, secrets, Gemini off,
// workflows on the reference repos) are printed as "measured by hand" with
// where that measurement lives.

import { prisma } from '../src/db/index.js';
import { queryNumber } from '../src/prometheus/prometheus.client.js';

const TEN_MIN = 10 * 60 * 1000;
const VERIFY_LIMIT_S = 90;
// actions that count toward give-up (healing.state.js COUNTED)
const counted = (a) => a.trigger === 'AUTO' && a.result !== 'SKIPPED' && !['SCALE_DOWN', 'NONE'].includes(a.action);

export const REFERENCE_REPOS = [
  'heroku/node-js-getting-started',
  'render-examples/express-hello-world',
  'digitalocean/sample-nodejs',
  'docker/getting-started-app',
  'fly-apps/hello-fly',
  'digitalocean/sample-python',
  'render-examples/flask-hello-world',
  'digitalocean/sample-flask',
  'koyeb/example-fastapi',
  'heroku/python-getting-started',
];
// P5f ran each reference repo from a fork, through the picker, so the setup PR
// could be merged and its workflow run. #1's upstream was renamed since P2
// (heroku/nodejs-getting-started); the fork has the new name
const FORK_OWNER = 'PunitXd';
const forkOf = (repo) => `${FORK_OWNER}/${repo === 'heroku/node-js-getting-started' ? 'nodejs-getting-started' : repo.split('/')[1]}`;
const SAMPLE_REPOS = ['PunitXd/kairo-node-sample', 'PunitXd/kairo-python-sample', 'PunitXd/kairo-dockerfile-sample'];
// times Docker's build cache was emptied on purpose (docker builder prune -af),
// so the next build of any commit is a fresh one
const CACHE_CLEARED = ['2026-11-19T11:01:11Z'];

const secs = (a, b) => (new Date(b) - new Date(a)) / 1000;
const fmt = (s) => (s === null || s === undefined || Number.isNaN(s) ? '—' : s >= 120 ? `${(s / 60).toFixed(1)} min` : `${s.toFixed(1)} s`);
const day = (d) => d.toISOString().slice(5, 16).replace('T', ' ');
const range = (xs) => (xs.length ? `${fmt(Math.min(...xs))} to ${fmt(Math.max(...xs))} (n=${xs.length})` : 'no data');

async function github(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'kairo-metrics' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res.json();
}

async function main() {
  const rows = [];
  const add = (metric, target, value, ok, how) => rows.push({ metric, target, value, ok, how });

  const apps = await prisma.app.findMany({ include: { pipelineRuns: true, releases: true } });
  const attempts = await prisma.remediationAttempt.findMany({
    include: { toRelease: true, fromRelease: true, incident: { include: { app: true } } },
    orderBy: { attemptedAt: 'asc' },
  });
  const incidents = await prisma.incident.findMany({ include: { attempts: true, app: true } });

  // 1. reference repos reaching a running preview: the latest run of each, upstream or fork
  const latest = REFERENCE_REPOS.map((repo) => {
    const runs = apps.filter((a) => [repo, forkOf(repo)].includes(a.repoFullName)).flatMap((a) => a.pipelineRuns);
    runs.sort((a, b) => b.startedAt - a.startedAt);
    return { repo, run: runs[0] ?? null };
  });
  const running = latest.filter((l) => l.run?.status === 'RUNNING');
  add('Reference repos reaching a running preview', '8 of 10', `${running.length} of 10`, running.length >= 8,
    `latest PipelineRun per repo; not running: ${latest.filter((l) => l.run?.status !== 'RUNNING').map((l) => `${l.repo} (${l.run ? `${l.run.status}${l.run.failedStep ? ` at ${l.run.failedStep}` : ''}` : 'never run'})`).join(', ') || 'none'}`);

  // 2. pick repo to preview running, for the sample apps. Kairo always runs
  // docker build, but a commit built before (by any app, since the last time
  // the build cache was emptied) finds every layer cached, so it is told apart
  const allRuns = apps.flatMap((a) => a.pipelineRuns).sort((a, b) => a.startedAt - b.startedAt);
  const built = (r) => r.status === 'RUNNING' || ['DEPLOYING'].includes(r.failedStep);
  const cacheFrom = (t) => Math.max(0, ...CACHE_CLEARED.map(Date.parse).filter((c) => c <= t));
  const cached = (r) => allRuns.some((o) => o !== r && o.commitSha && o.commitSha === r.commitSha && built(o) && o.startedAt < r.startedAt && o.startedAt.getTime() >= cacheFrom(r.startedAt.getTime()));
  const sampleRuns = apps
    .filter((a) => SAMPLE_REPOS.includes(a.repoFullName))
    .flatMap((a) => a.pipelineRuns)
    .filter((r) => r.status === 'RUNNING' && r.finishedAt);
  const sampleTimes = sampleRuns.map((r) => secs(r.startedAt, r.finishedAt));
  const freshRuns = sampleRuns.filter((r) => !cached(r));
  const freshTimes = freshRuns.map((r) => secs(r.startedAt, r.finishedAt));
  const cachedTimes = sampleRuns.filter(cached).map((r) => secs(r.startedAt, r.finishedAt));
  const emptyCache = freshRuns.filter((r) => CACHE_CLEARED.some((c) => Date.parse(c) <= r.startedAt.getTime() && !allRuns.some((o) => o.startedAt > new Date(c) && o.startedAt < r.startedAt && built(o))));
  add('Pick repo to preview running (sample apps)', 'under 3 min', `first build of the commit: ${range(freshTimes)}, of which on an empty build cache: ${range(emptyCache.map((r) => secs(r.startedAt, r.finishedAt)))}; commit built before: ${range(cachedTimes)}`, sampleTimes.length > 0 && Math.max(...sampleTimes) < 180,
    `PipelineRun startedAt to finishedAt (RUNNING), every run of ${SAMPLE_REPOS.map((r) => r.split('/')[1]).join(', ')}. "Built before": an earlier run had already built that commit since the build cache was last emptied, so all its layers were cached. A first build of a commit can still reuse the dependency layers of an earlier commit; "empty build cache" is the first build after docker builder prune (CACHE_CLEARED). First builds: ${freshRuns.map((r) => `${day(r.startedAt)} ${r.commitSha?.slice(0, 7)} ${fmt(secs(r.startedAt, r.finishedAt))}`).join(', ') || 'none'}`);

  // 3. generated workflows passing on first run: the first Actions run of
  // kairo.yml on each reference fork. GitHub answers 404 while kairo.yml isn't
  // on the default branch (no setup PR, or not merged), and for a fork deleted
  // after P5f; the values P5f read are in note 06
  const firstRun = async (repo) => {
    try {
      const data = await github(`/repos/${repo}/actions/workflows/kairo.yml/runs?per_page=100`);
      const first = [...data.workflow_runs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
      return { repo, conclusion: first ? first.conclusion ?? first.status : 'no run yet' };
    } catch (e) {
      return { repo, conclusion: /404/.test(e.message) ? 'no kairo.yml on the default branch' : `unknown (${e.message})` };
    }
  };
  const refWf = [];
  for (const repo of REFERENCE_REPOS) refWf.push(await firstRun(forkOf(repo)));
  const ownWf = [];
  for (const repo of SAMPLE_REPOS) ownWf.push(await firstRun(repo));
  const passed = refWf.filter((w) => w.conclusion === 'success').length;
  add('Generated workflows passing on first run', '8 of 10', `${passed} of 10 reference forks`, passed >= 8,
    `first kairo.yml run on each fork: ${refWf.map((w) => `${w.repo.split('/')[1]} ${w.conclusion}`).join(', ')}. Sample repos: ${ownWf.map((w) => `${w.repo.split('/')[1]} ${w.conclusion}`).join(', ')}`);

  // 4. merged push to new release live: commit time to Release deployedAt (GHCR releases)
  const pushes = [];
  for (const app of apps) {
    for (const r of app.releases.filter((x) => x.source === 'GHCR')) {
      try {
        const c = await github(`/repos/${app.repoFullName}/commits/${r.commitSha}`);
        pushes.push({ s: secs(c.commit.committer.date, r.deployedAt), sha: r.commitSha.slice(0, 7), repo: app.repoFullName });
      } catch {
        // a private repo or a rate limit: skipped, counted below
      }
    }
  }
  const pushS = pushes.map((p) => p.s).filter((s) => s >= 0);
  add('Merged push to new release live', 'under 5 min', range(pushS), pushS.length > 0 && Math.max(...pushS) < 300,
    `commit time (GitHub) to GHCR Release deployedAt: ${pushes.map((p) => `${p.sha} ${fmt(p.s)}`).join(', ') || 'none'}`);

  // 5. crash-looping release rolled back within 2 min (where an earlier healthy release existed)
  const crash = incidents.filter((i) => i.alertName === 'KairoCrashLoop' && i.resolvedAt);
  const rolled = crash.filter((i) => i.attempts.some((a) => a.action === 'ROLLBACK' && ['VERIFIED', 'UNVERIFIED', 'APPLIED'].includes(a.result)));
  const crashS = rolled.map((i) => secs(i.startedAt, i.resolvedAt));
  const breaks = attempts.filter((a) => a.action === 'ROLLBACK' && a.fromRelease?.source === 'TEST' && a.result !== 'SKIPPED');
  const breakToRollback = breaks.map((a) => secs(a.fromRelease.deployedAt, a.attemptedAt));
  // the Break It release is recorded when it is deployed, the moment of the click
  const breakList = breaks.map((a) => `${day(a.attemptedAt)} ${fmt(secs(a.fromRelease.deployedAt, a.attemptedAt))}${a.verifiedAt ? ` (verified ${fmt(secs(a.fromRelease.deployedAt, a.verifiedAt))})` : ''}`).join(', ');
  add('Crash-looping release rolled back', 'within 2 min', range(crashS), crashS.length > 0 && Math.max(...crashS) <= 120,
    `Incident startedAt to resolvedAt for KairoCrashLoop with a rollback (${crash.length - rolled.length} without one, e.g. dry run or no healthy target). Stricter, not the PRD measure: Break It click to the rollback action (verified in brackets), which includes the crash-loop wait before the alert: ${range(breakToRollback)}: ${breakList}`);

  // 6. rollbacks to unhealthy releases
  const rollbacks = attempts.filter((a) => a.action === 'ROLLBACK' && !['SKIPPED', 'FAILED'].includes(a.result));
  const bad = rollbacks.filter((a) => !a.toRelease?.healthyAt || a.toRelease.healthyAt > a.attemptedAt);
  add('Rollbacks to unhealthy releases', 'zero', `${bad.length} of ${rollbacks.length}`, bad.length === 0,
    'every ROLLBACK attempt that ran: its target Release had healthyAt set before the attempt');

  // 7. actions with an unknown outcome, since verification exists (P3)
  const firstVerified = attempts.find((a) => a.result === 'VERIFIED' || a.result === 'UNVERIFIED');
  const since = firstVerified?.attemptedAt ?? new Date();
  const old = (a) => Date.now() - a.attemptedAt.getTime() > (VERIFY_LIMIT_S + 30) * 1000;
  const ran = attempts.filter((a) => a.attemptedAt >= since && !a.dryRun && !['SKIPPED', 'FAILED'].includes(a.result) && old(a));
  const unknown = ran.filter((a) => a.result === 'APPLIED');
  const checkS = ran.filter((a) => a.verifiedAt).map((a) => secs(a.attemptedAt, a.verifiedAt));
  const before = attempts.filter((a) => a.attemptedAt < since && a.result === 'APPLIED').length;
  add('Actions with an unknown outcome', 'zero', `${unknown.length} of ${ran.length}`, unknown.length === 0,
    `attempts since the first verified one (${since.toISOString().slice(0, 16)}Z) still APPLIED after 120 s; verified within ${range(checkS)}. ${before} older attempts from before verification existed (P1, P2) were never checked`);

  // 8. healing with Postgres stopped
  add('Healing with Postgres stopped', 'restart still happens', 'restart happened (P1 and P5f)', true, 'measured by hand: note 02 (P1), check 8; note 06 (P5f, 19 Nov 11:38): kairo-db stopped 60 s, /leak, RESTART and its check (VERIFIED) with the database down, the incident saved with the attempt VERIFIED once Postgres was back (fixed in 54dcd59; the first P5f run at 11:27 lost its verification, and the boot re-check marked it VERIFIED 10 min later)');

  // 9 and 10. scale up under load, and back to 1 after it
  const cpu = incidents.filter((i) => ['KairoHighCpu', 'KairoHighLatency'].includes(i.alertName));
  const up = cpu.flatMap((i) => i.attempts.filter((a) => a.action === 'SCALE_UP' && a.verifiedAt).map((a) => secs(i.startedAt, a.verifiedAt)));
  const downs = cpu.flatMap((i) => i.attempts.filter((a) => a.action === 'SCALE_DOWN' && a.verifiedAt && i.resolvedAt).map((a) => ({ at: a.verifiedAt, s: secs(i.resolvedAt, a.verifiedAt) })));
  const down = downs.map((d) => d.s);
  add('Scale-up under Send Traffic', 'extra replica within 2 min', range(up), up.length > 0 && Math.max(...up) <= 120,
    'alert start to the scale-up verified (the click itself is not stored). From the click, timed by hand in P5f (note 06): 56.5 s (python) and 63.5 s (node)');
  add('Scale back to 1 after load', 'within 7 min', range(down), down.length > 0 && Math.max(...down) <= 420,
    `alert resolved (load over) to the scale-down verified, each: ${downs.map((d) => `${d.at.toISOString().slice(5, 16).replace('T', ' ')} ${fmt(d.s)}`).join(', ')}`);

  // 11. endless remediation loops: counted attempts per app in any 10 minutes
  const byApp = new Map();
  for (const a of attempts.filter(counted)) {
    const k = a.incident.app.slug;
    byApp.set(k, [...(byApp.get(k) ?? []), a.attemptedAt.getTime()]);
  }
  const windows = [];
  for (const [slug, ts] of byApp) {
    let max = 0;
    let at = null;
    for (let i = 0; i < ts.length; i++) {
      const n = ts.filter((t) => t >= ts[i] && t < ts[i] + TEN_MIN).length;
      if (n > max) [max, at] = [n, ts[i]];
    }
    windows.push({ slug, max, at });
  }
  const worst = windows.sort((a, b) => b.max - a.max)[0];
  // the give-up race fix (4d82e61, 10 Nov 21:48 UTC): the same count from then on
  const FIX = Date.parse('2026-11-10T21:48:00Z');
  let afterFix = 0;
  for (const ts of byApp.values()) for (const t of ts.filter((x) => x >= FIX)) afterFix = Math.max(afterFix, ts.filter((x) => x >= t && x < t + TEN_MIN).length);
  const gaveUp = attempts.filter((a) => /gave up/.test(a.reason ?? '')).length;
  const over = windows.filter((w) => w.max > 3);
  add('Endless remediation loops', 'zero; give-up always triggers', `max ${worst?.max ?? 0} counted attempts in 10 min (${worst?.slug ?? '—'}); since the give-up fix: max ${afterFix}`, afterFix <= 3,
    `${gaveUp} give-up stops with a stored reason (reasons are stored since P3c; the 10 Nov 22:00 stop predates that). ${over.map((w) => `${w.slug} had ${w.max} from ${new Date(w.at).toISOString().slice(0, 16)}Z`).join('; ') || 'no app over 3'}. Met is judged from the give-up race fix on (4d82e61, 10 Nov 21:48 UTC); the windows over 3 before it are the race that fix closed (note 06, P5a)`);

  // 12. platform fits the laptop: the node's memory, peak over Prometheus's day
  let peak = null;
  let cap = null;
  try {
    peak = await queryNumber('max_over_time(sum(node_memory_working_set_bytes)[1d:1m])');
    cap = await queryNumber('sum(kube_node_status_capacity{resource="memory"})');
  } catch {
    // Prometheus not answering
  }
  const gb = (b) => (b / 1e9).toFixed(2);
  add('Platform fits the laptop', 'inside the 5 GB cap with 3 apps', peak ? `peak ${gb(peak)} GB of ${gb(cap)} GB (24 h)` : 'Prometheus not answering', peak ? peak < cap : null,
    'max over the last day of the node working set (kubelet), against the node capacity Docker Desktop gives the VM; P5f measures it with 3 apps under load');

  // 13 and 14
  add('Secrets leaked', 'zero', 'see npm test', null, 'automated: tests/unit/secrets.test.js plants fake secrets and searches every log line, HTTP response, Gemini request and the browser bundle; part of npm test');
  add('Works without Gemini', 'full loop passes', 'passed in P4', true, 'measured by hand: note 05 (P4c), GEMINI_ENABLED=false loop');

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log('| Metric | Target | Measured | Met | How |');
    console.log('| --- | --- | --- | --- | --- |');
    for (const r of rows) console.log(`| ${r.metric} | ${r.target} | ${r.value} | ${r.ok === null ? 'see how' : r.ok ? 'yes' : 'no'} | ${r.how} |`);
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
