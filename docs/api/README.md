# Kairo API

All endpoints are under `/api` on the backend (`http://localhost:4000`) and return JSON. Errors look like `{ "error": "<message>" }`: expected errors keep their status code (400, 404), anything else is a 500 with a generic message. Dates are ISO 8601 strings in UTC.

The enum values below are fixed. They live in `backend/src/types/`, the Prisma schema and `frontend/src/types/enums.js`, and a test keeps the three equal.

State as of P2a. The app page, PR, metrics, logs, rollback, test panel and delete endpoints (P2b, P2c, P3) aren't here yet.

## Sign-in (FR-1, FR-2, FR-42)

Every endpoint needs a signed-in user whose GitHub login is in `ALLOWED_GITHUB_LOGINS`, except `POST /api/alerts` (bearer token) and `/api/auth/*`. Without one: `401 { "error": "Sign in first" }`.

The session is an httpOnly, `SameSite=Lax` cookie, `kairo_session`, signed with `SESSION_SECRET` and valid for 12 hours. It holds the user's id and login, nothing from GitHub. The allow-list is checked again on every request, so removing a login signs that person out at once.

| Method and path | What it does |
| --- | --- |
| `GET /api/auth/login` | 302 to GitHub's sign-in page for the Kairo GitHub App, with a one-time `state` cookie |
| `GET /api/auth/callback` | Where GitHub sends the browser back, after sign-in and after installing the App. 302 to `/` (signed in), `/apps/new` (after an install), `/not-invited?login=<login>` (not on the allow-list) or `/signin?error=<reason>` |
| `GET /api/auth/install` | 302 to the App's install page, which also changes which repos an existing installation sees. Signed in only |
| `GET /api/auth/me` | The signed-in user, or 401 |
| `POST /api/auth/logout` | 204, clears the cookie |

`GET /api/auth/me`:

```json
{
  "login": "PunitXd",
  "avatarUrl": "https://avatars.githubusercontent.com/u/1?v=4",
  "installUrl": "/api/auth/install",
  "installations": [{ "id": "cm...", "accountLogin": "PunitXd" }]
}
```

`/signin?error=` reasons: `not-configured` (GitHub App settings or `SESSION_SECRET` missing), `cancelled`, `no-code`, `state` (expired or started in another tab), `github` (GitHub didn't answer), `sign-in-first` (an install return without a session), `account-mismatch` (GitHub came back as another account).

GitHub's user token is used only inside the callback (who are you, which installations can you reach) and then revoked. Installation tokens are minted for each request and never stored, logged or sent to the browser (FR-5).

## GET /api/repos

The repo picker (FR-3, FR-6): every repo the user's installations can see, newest push first.

```json
{
  "installations": [{ "id": "cm...", "accountLogin": "PunitXd", "repoCount": 4 }],
  "repos": [
    {
      "fullName": "PunitXd/kairo-node-sample",
      "private": false,
      "defaultBranch": "main",
      "pushedAt": "2026-11-10T09:12:00Z",
      "htmlUrl": "https://github.com/PunitXd/kairo-node-sample",
      "installationId": "cm...",
      "disabledReason": null,
      "app": { "id": "cm...", "slug": "kairo-node-sample" }
    }
  ],
  "limit": { "running": 2, "max": 3 }
}
```

| Field | Meaning |
| --- | --- |
| `disabledReason` | `"Private repos aren't supported yet"` for private repos, else `null` |
| `app` | The Kairo app this repo already is, else `null` |
| `limit.running` | Apps that count against the limit (FR-9); `null` if the cluster can't be reached |

An installation that was removed on GitHub is marked suspended and left out. `502` if GitHub doesn't answer.

## POST /api/apps

Starts onboarding from a picked repo (FR-3). Body `{ "repoFullName": "owner/repo" }`. `202` with a [Deployment](#deployment), the same as `POST /api/deployments`. A repo that is already an app gets a new run.

| Status | When |
| --- | --- |
| `400` | `repoFullName` isn't `owner/repo`, or the repo is private |
| `404` | None of your installations can see the repo |
| `409` | Limit of 3 running apps reached (FR-9) |
| `502` | GitHub didn't answer |
| `503` | The cluster can't be reached, so the limit can't be checked |

## GET /api/health

```json
{ "ok": true, "db": "up", "cluster": "up", "dryRun": false }
```

`db` and `cluster` are `"up"` or `"down"`. `ok` is always `true` when the API answers. `dryRun` is `true` when healing only records incidents and never touches pods (`REMEDIATION_DRY_RUN`). The frontend polls this every 10 s.

**Changed in P1:** added `dryRun`.

## POST /api/deployments

**Since P2:** a testing shortcut, behind sign-in and hidden from the UI (AQ10). The UI onboards through `POST /api/apps`.

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
  "repoFullName": "heroku/node-js-getting-started",
  "installed": false,
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
| `installed` | `true` when the app was picked from a GitHub App installation (`POST /api/apps`), `false` for the URL shortcut. Retry uses the same route |
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
