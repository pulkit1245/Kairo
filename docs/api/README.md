# Kairo API

All endpoints are under `/api` on the backend (`http://localhost:4000`) and return JSON. Errors look like `{ "error": "<message>" }`: expected errors keep their status code (400, 404), anything else is a 500 with a generic message. Dates are ISO 8601 strings in UTC.

The enum values below are fixed. They live in `backend/src/types/`, the Prisma schema and `frontend/src/types/enums.js`, and a test keeps the three equal.

State as of P1. Sign-in (P2) and the app, metrics, logs, rollback, test panel and delete endpoints (P2, P3) aren't here yet.

## GET /api/health

```json
{ "ok": true, "db": "up", "cluster": "up", "dryRun": false }
```

`db` and `cluster` are `"up"` or `"down"`. `ok` is always `true` when the API answers. `dryRun` is `true` when healing only records incidents and never touches pods (`REMEDIATION_DRY_RUN`). The frontend polls this every 10 s.

**Changed in P1:** added `dryRun`.

## POST /api/deployments

Starts onboarding for a public GitHub repo. Returns `202` with a Deployment straight away; the pipeline runs in the background.

```json
{ "repoUrl": "https://github.com/owner/repo" }
```

Posting a repo that's already an app adds a new run to that app. The run then goes through every step in the background: clone, detect, generate (and check) the files, build the image with Docker Desktop's engine, deploy to namespace `kairo-<slug>`, and wait for the app to be ready.

Errors, all before anything is cloned:

| Status | When |
| --- | --- |
| `400` | `repoUrl` is missing or isn't an `https://github.com/owner/repo` URL |
| `409` | `Limit of 3 running apps reached. Delete one before adding another.` Apps with pods in the cluster plus apps with a run still going count; redeploying one of them is allowed (FR-9) |
| `503` | The cluster can't be reached, so the limit can't be checked |

## GET /api/deployments

The latest 20 Deployments, newest first, **without** `configs`.

## GET /api/deployments/:id

One Deployment **with** `configs`, or `404`. Poll it every 3 s while the run is in progress (FR-8).

### Deployment

A "deployment" is one pipeline run plus a few fields from its app.

```json
{
  "id": "cmwak1al20001sa8as8n96zay",
  "appId": "cmwajzqex0003sazk5mt2kra8",
  "repoUrl": "https://github.com/heroku/node-js-getting-started.git",
  "appName": "node-js-getting-started",
  "status": "GENERATING",
  "failedStep": null,
  "stack": "NODE",
  "commitSha": "d33649d...",
  "failureReason": null,
  "logTail": [],
  "explanation": null,
  "startedAt": "2026-11-10T10:35:50.000Z",
  "finishedAt": "2026-11-10T10:35:53.000Z",
  "configs": [
    { "kind": "DOCKERFILE", "origin": "GENERATED", "path": "Dockerfile", "content": "FROM node:20-alpine\n..." }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | The pipeline run's id |
| `appName` | The app's slug: its Kubernetes name and the `app` label on its alerts |
| `status` | `CLONING`, `DETECTING`, `GENERATING`, `BUILDING`, `DEPLOYING`, `RUNNING` or `FAILED` |
| `failedStep` | The step it was on when it failed, else `null` |
| `stack` | `NODE`, `PYTHON` or `null` before detection |
| `failureReason` | Readable reason when `FAILED`, one line. E.g. `Build failed (docker exited with code 1)` or `App didn't answer on $PORT (3000) within 3 minutes (CrashLoopBackOff)` |
| `logTail` | When the build failed: its last 80 log lines (FR-28). Otherwise `[]` |
| `explanation` | Gemini's explanation of a failure (P4), else `null` |
| `finishedAt` | `null` while the run is still going. Set when it ends, at `RUNNING` or `FAILED` |
| `configs[].kind` | `DOCKERFILE`, `DEPLOYMENT`, `SERVICE`, `INGRESS`, `WORKFLOW` or `ALERT_RULES` |
| `configs[].origin` | `GENERATED`, or `KEPT_EXISTING` when the repo already had the file (P2) |

The image tag is the full commit sha: `kairo/<appName>:<commitSha>`. A run that reaches `RUNNING` records an `ACTIVE` release; the app answers through Traefik on `http://<appName>.kairo.local` (`curl -H "Host: <appName>.kairo.local" http://localhost/`).

**Changed in P1:** added `logTail`; runs now go on to `BUILDING`, `DEPLOYING` and `RUNNING`; `configs` also has `INGRESS` (`k8s/ingress.yaml`) and `ALERT_RULES` (`k8s/alert-rules.yml`); the Service is `ClusterIP`.

**Changed in P0** (phase-1 shape → now): `id` is the pipeline run id. Added `appId`, `failedStep`, `explanation`, `startedAt` and `finishedAt`. Removed `createdAt` and `updatedAt`. `configs[].kind` went from `dockerfile` / `k8s` to one kind per file, and each file gained `origin`. The list endpoint no longer includes `configs`.

## POST /api/alerts

Alertmanager's webhook (payload version 4). Alertmanager calls it at `http://host.docker.internal:4000/api/alerts`.

**Needs `Authorization: Bearer <token>`** with the shared token (`ALERT_WEBHOOK_TOKEN` in `backend/.env`, the same value Alertmanager reads from Secret `monitoring/kairo-alert-webhook-token`). Without it, or with a wrong one, the answer is `401 { "error": "Missing or invalid bearer token" }` (FR-45). If the backend has no token configured, every call gets 401.

Kairo acts first and records second (FR-74): for a new firing alert it runs the action (e.g. deletes the pod for `KairoOOMKilled`), then writes the incident and its attempt. A write that fails is retried once and logged; it never stops the action.

```json
{ "received": 1, "skipped": 1, "failed": 0 }
```

`skipped` counts alerts without an `alertname`, an app label or a fingerprint, **and** firing alerts whose app label matches no app. It returns `400` only when the body isn't an Alertmanager payload and `401` without the token. Every other case returns `200`, so Alertmanager doesn't retry forever.

The five alert names are fixed: `KairoAppDown` and `KairoOOMKilled` → `RESTART`, `KairoCrashLoop` → `ROLLBACK`, `KairoHighCpu` and `KairoHighLatency` → `SCALE_UP` (rollback and scaling are recorded as `SKIPPED` until P3). Any other name is recorded with action `NONE`.

## GET /api/incidents

The latest 50 Incidents, newest first.

### Incident

```json
{
  "id": "cmwakhgb10001sa1yvot8weu4",
  "appId": "cmwajzqex0003sazk5mt2kra8",
  "appName": "node-js-getting-started",
  "alertName": "KairoOOMKilled",
  "cause": "Container went over its memory limit",
  "status": "RESOLVED",
  "explanation": null,
  "startedAt": "2026-11-10T10:48:33.000Z",
  "resolvedAt": "2026-11-10T10:48:56.000Z",
  "recoverySeconds": 23,
  "githubIssueNumber": null,
  "attempts": [
    {
      "id": "cmwakhgb40003sa1y2c7pk1ad",
      "action": "RESTART",
      "trigger": "AUTO",
      "dryRun": true,
      "result": "SKIPPED",
      "fromReleaseId": null,
      "toReleaseId": null,
      "attemptedAt": "2026-11-10T10:48:33.120Z",
      "verifiedAt": null
    }
  ]
}
```

| Field | Values |
| --- | --- |
| `status` | `OPEN`, `RESOLVED` |
| `recoverySeconds` | Seconds from start to resolve, one decimal; `null` while open |
| `attempts[]` | Oldest first. One per action Kairo took (or chose not to) |
| `attempts[].action` | `RESTART`, `ROLLBACK`, `SCALE_UP`, `SCALE_DOWN`, `NONE` |
| `attempts[].trigger` | `AUTO`, `MANUAL` |
| `attempts[].result` | `APPLIED`, `VERIFIED`, `UNVERIFIED`, `FAILED`, `SKIPPED` (dry run, no action for the alert, or not built yet) |

**Changed in P0:** removed `deploymentId` and `action`. Added `appId`, `explanation`, `githubIssueNumber` and `attempts`. `recoverySeconds` is now stored when the incident resolves instead of being worked out on every request.

## Other values

Not in any response yet, but fixed already:

- App health: `HEALTHY`, `HEALING`, `NEEDS_ATTENTION`
- Release source: `PREVIEW`, `GHCR`
- Release status: `ACTIVE`, `SUPERSEDED`, `ROLLED_BACK`, `FAILED`
