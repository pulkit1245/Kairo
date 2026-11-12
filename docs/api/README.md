# Kairo API

All endpoints are under `/api` on the backend (`http://localhost:4000`) and return JSON. Errors look like `{ "error": "<message>" }`: expected errors keep their status code (400, 404), anything else is a 500 with a generic message. Dates are ISO 8601 strings in UTC.

The enum values below are fixed. They live in `backend/src/types/`, the Prisma schema and `frontend/src/types/enums.js`, and a test keeps the three equal.

State as of P2b. The app page, metrics, logs, rollback, test panel and delete endpoints (P2c, P3) aren't here yet.

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

## GET /api/apps

The Apps list (since P4, Stitch 06): every app that isn't deleted, running apps first. An app whose onboarding failed is listed too, with no `release` and its run's `failedStep`.

```json
{
  "apps": [
    {
      "id": "…",
      "slug": "kairo-node-sample",
      "repoFullName": "PunitXd/kairo-node-sample",
      "stack": "NODE",
      "health": "HEALTHY",
      "attentionReason": null,
      "autoHeal": true,
      "replicas": 1,
      "publicUrl": "https://rebecca-teeth-carriers-disclose.trycloudflare.com",
      "tunnel": "up",
      "pipeline": { "id": "…", "status": "RUNNING", "failedStep": null, "startedAt": "…", "finishedAt": "…" },
      "release": { "id": "…", "commitSha": "…", "commitMessage": "docs: rollout test 2", "source": "GHCR", "deployedAt": "…" },
      "openIncidents": 0,
      "lastIncident": { "id": "…", "alertName": "KairoHighCpu", "cause": "…", "status": "RESOLVED", "startedAt": "…", "recoverySeconds": 45 },
      "now": { "rps": 0, "cpuCores": 0.001, "cpuShare": 0.002, "memoryBytes": 44040192, "memoryLimitBytes": 268435456, "replicasReady": 1, "replicasDesired": 1, "unavailable": false }
    }
  ],
  "running": 2,
  "maxRunning": 3,
  "cluster": { "cpuCores": 0.5, "cpuTotal": 4, "memoryBytes": 3023646720, "memoryTotalBytes": 5034045440 }
}
```

| Field | Meaning |
| --- | --- |
| `release` | The `ACTIVE` release, or `null` when nothing is deployed |
| `now` | One instant Prometheus query per number; `null` for an app with no release. A number is `null` when its query failed or has no data; `unavailable` is `true` when every query failed |
| `now.cpuShare` | CPU of all pods as a share of what the ready pods may use (0.5 core each) |
| `running` | Apps with an `ACTIVE` release; `maxRunning` is the limit (FR-9) |
| `openIncidents` | The app's incidents still `OPEN`, for the sidebar's badge (since P4) |
| `cluster` | The sidebar's cluster card (since P4): the node's CPU in cores and memory in bytes in use, against what Kubernetes can give pods (`kube_node_status_allocatable`). Three Prometheus queries run at once with a 2 s timeout, alongside the list; each value is `null` when its query failed or timed out, and the apps are returned either way |

## GET /api/apps/:slug

The app page (since P2c): header, active release and the last 10 releases. 404 for an unknown or deleted app.

```json
{
  "slug": "kairo-node-sample",
  "repoFullName": "PunitXd/kairo-node-sample",
  "repoUrl": "https://github.com/PunitXd/kairo-node-sample",
  "defaultBranch": "main",
  "installed": true,
  "stack": "NODE",
  "health": "HEALTHY",
  "autoHeal": true,
  "replicas": 1,
  "publicUrl": "https://rebecca-teeth-carriers-disclose.trycloudflare.com",
  "tunnel": "up",
  "pipeline": { "id": "…", "status": "RUNNING", "failedStep": null, "startedAt": "…", "finishedAt": "…" },
  "release": { "id": "…", "commitSha": "…", "commitMessage": "Change the greeting", "imageRef": "ghcr.io/punitxd/kairo-node-sample:…", "source": "GHCR", "status": "ACTIVE", "deployedAt": "…", "healthyAt": null, "graceEndsAt": "…", "imageStored": true },
  "releases": [ "…same shape, newest first…" ],
  "pr": { "state": "MERGED", "number": 1, "url": "https://github.com/PunitXd/kairo-node-sample/pull/1", "error": null, "bot": "kairo-devops[bot]" },
  "watchingGhcr": true
}
```

| Field | Meaning |
| --- | --- |
| `release` | The `ACTIVE` release, or `null` |
| `publicUrl` | The app's public link (FR-40): a Cloudflare quick tunnel to Traefik, saved once it connects and its name resolves. `null` while it starts or restarts, and after a delete. It changes every time the tunnel restarts (FR-41) |
| `tunnel` | `starting`, `up`, `restarting` (died, a new one within 30 s), or `null` (no tunnel: nothing deployed, or `TUNNELS_ENABLED=false`) |
| `releases[].source` | `PREVIEW` (built on the laptop during onboarding), `GHCR` (built by the repo's workflow, rolled out by Kairo) or `TEST` (Break It's release that exits on start, since P3) |
| `releases[].healthyAt` | Set once the release passed its 60 s grace window (FR-72); `graceEndsAt` is when that window ends |
| `releases[].imageStored` | `false` once its image was pruned (only the last 3 releases keep theirs, FR-38) |
| `releases[].rollbackBlockedBy` | `null` when "Roll back to this" can run now; otherwise why not, e.g. "this release is the one running now", "only releases that were marked healthy can be rolled back to", "the current release is still in its 60 s grace window" (since P4d) |
| `watchingGhcr` | `true` once the setup PR is merged: every 30 s Kairo checks GHCR for the default branch's newest commit (FR-35) |
| `health` | `HEALTHY`, `HEALING` (an action is being checked) or `NEEDS_ATTENTION` (Kairo stopped acting, since P3) |
| `attentionReason` | Why it needs attention, e.g. "3 attempts in 10 minutes didn't fix it"; `null` otherwise or after a backend restart |
| `traffic` | Send Traffic's current or last run, or `null` |
| `incidents` | The app's latest 20 incidents, newest first, shaped as in `GET /api/incidents` (since P3) |

## GET /api/apps/:slug/metrics

The app page's numbers (FR-56), polled every 5 s. The backend runs fixed queries against Prometheus (`PROMETHEUS_URL`, the port-forward); nothing in the request becomes query text (FR-57).

```json
{
  "window": { "startSec": 1762846200, "endSec": 1762848000, "stepSec": 15 },
  "now": { "rps": 48.2, "errorRate": 0, "cpuCores": 0.41, "memoryBytes": 52428800, "replicasReady": 2, "replicasDesired": 2, "restarts": 0 },
  "limits": { "cpuCoresPerPod": 0.5, "memoryBytesPerPod": 268435456, "maxReplicas": 3 },
  "series": { "rps": [[1762846215, 0]], "errorRate": [[1762846215, null]], "cpu": [], "memory": [], "replicas": [] },
  "failed": []
}
```

| Field | Meaning |
| --- | --- |
| `series.*` | The last 30 minutes, `[unixSeconds, value]`, one point per 15 s where Prometheus has one. `null` = no value (an error rate with no requests) |
| `rps` | Requests per second through Traefik, 1-minute rate |
| `errorRate` | Share of answers that were 5xx, 0 to 1; `null` with no traffic |
| `cpu` | All pods together, in cores (`cpuCoresPerPod` is each pod's limit) |
| `memory` | The largest pod's working set in bytes, the number the 256Mi limit applies to |
| `replicas` | Available replicas; `now.replicasDesired` is what the Deployment asks for |
| `now.restarts` | Container restarts by Kubernetes in the last 30 minutes (Kairo's restarts replace the pod, so they show as incidents instead) |
| `now.*` | The newest point of each series |
| `failed` | Names whose query failed; their values are `null` |

503 when Prometheus doesn't answer at all.

## GET /api/apps/:slug/logs

The newest pod's last 50 log lines (FR-58), polled every 5 s. Nothing is stored.

```json
{
  "pod": "kairo-python-sample-6c5775b86c-pdlbv",
  "previous": false,
  "lines": [{ "time": "2026-11-11T07:37:44.817787208Z", "text": "GET /" }],
  "fetchedAt": "2026-11-11T07:37:46.000Z"
}
```

`previous` is `true` when the container is waiting to restart (a crash loop) and the lines are from its last run. `pod` is `null` and `lines` empty when the app has no pod. 502 when the cluster doesn't answer.

## PATCH /api/apps/:slug

`{ "autoHeal": false }` turns automatic healing off or on for the app (FR-51), and returns the app as `GET /api/apps/:slug` does. With it off, alerts still open incidents, each with a `SKIPPED` attempt that names the action Kairo would have taken, the app shows `NEEDS_ATTENTION`, and nothing in the cluster changes. 400 unless `autoHeal` is a boolean.

## POST /api/apps/:slug/traffic

Send Traffic (FR-62): 50 requests a second for 60 s, through Traefik with the app's host. If the app answers `/work`, the requests are `GET /work?ms=20`, which burns CPU so scaling fires; otherwise `GET /`. 202:

```json
{ "path": "/work?ms=20", "rps": 50, "startedAt": "…", "endsAt": "…" }
```

409 while traffic is already going to the app. Progress shows on `GET /api/apps/:slug` as `traffic: { running, path, startedAt, endsAt, sent, ok, failed }`, the run going now or the last one.

## POST /api/apps/:slug/break

Break It (FR-63). `{ "kind": "kill-pod" }` deletes the newest pod; Kubernetes replaces it by itself, so Kairo does nothing. `{ "kind": "broken-release" }` deploys `kairo/broken-release:1`, an image that exits on start: it is recorded as a `TEST` release, `ACTIVE`, the old pod keeps serving, the new one crash-loops, and `KairoCrashLoop` makes Kairo roll back. 202:

```json
{ "kind": "broken-release", "releaseId": "…", "image": "kairo/broken-release:1" }
```

400 for another `kind`; 409 during a rollout or grace window, with no running release, or when the broken release already runs.

## POST /api/apps/:slug/rollback

"Roll back to this" from the release list (FR-60, FR-61, since P4d). Body `{ "releaseId": "…" }`, an earlier release that was marked healthy and whose image is still stored. It takes the automatic rollback's path with trigger `MANUAL`: the image is set, the target's 60 s grace window starts, the app is `HEALING`, and the 90 s check runs in the background. It is allowed while the app is `NEEDS_ATTENTION` and with auto-heal off, and a verified one ends `NEEDS_ATTENTION`. It is recorded as its own incident (`alertName: "ManualRollback"`, cause "Rolled back by <login> from the release list"), resolved when the check ends, and reported on the app's GitHub issue like any rollback (FR-55). 202 once the rollback ran:

```json
{ "incidentId": "…", "note": "rolled back to 9c8a2b0", "attempt": { "action": "ROLLBACK", "trigger": "MANUAL", "result": "APPLIED", "fromReleaseId": "…", "toReleaseId": "…", "…": "…" } }
```

`attempt.result` is `FAILED` if Kubernetes refused the change. 400 without `releaseId`; 404 for an unknown app or release; 409 with the reason (the same text as `rollbackBlockedBy`) for the running release, a release never marked healthy or Break It's, a pruned image or one no longer on the laptop, `REMEDIATION_DRY_RUN`, and during a rollout, a grace window or another action's check.

## DELETE /api/apps/:slug

Deletes the app (FR-65, Stitch 09). The body must name it: `{ "confirm": "kairo-node-sample" }`.

Kairo deletes the app's namespace (its Deployment, Service, Ingress and pods go with it) and its key in the alert rules ConfigMap, stops its grace window, Send Traffic, its tunnel (the public link) and healing, closes its open incidents (no recovery time), and sets `deletedAt`. Once the namespace is gone, it removes the app's images from the laptop. Releases, incidents and attempts are kept. GitHub is never touched: the repo, its PR, the files Kairo added, GHCR images and issues stay (FR-66). Adding the same repo again reuses the app, its slug and its history.

```json
{ "slug": "kairo-node-sample", "namespace": "kairo-kairo-node-sample", "namespaceState": "deleting", "closedIncidents": 0, "imagesToRemove": 4, "deletedAt": "…" }
```

| Status | When |
| --- | --- |
| `400` | `confirm` isn't the app's name |
| `404` | Unknown or already deleted |
| `409` | A pipeline run, a rollout or an action being checked (up to 90 s) is in progress |
| `502` | The cluster refused; nothing is marked deleted, so it can be tried again |

## POST /api/apps/:slug/pr

Try again when the setup PR couldn't be opened (AQ11). If the preview is healthy, Kairo opens or updates the PR; if it wasn't, Kairo checks it again first (FR-72) and opens the PR only if it passes. Returns the app's PR fields:

```json
{ "prState": "OPEN", "prNumber": 3, "prError": null }
```

| Status | When |
| --- | --- |
| `404` | No such app among your installations |
| `409` | The PR is already merged, the preview is still in its grace window, or there's no running preview |

## GET /api/health

```json
{
  "ok": true, "db": "up", "cluster": "up", "dryRun": false,
  "gemini": { "state": "up", "model": "gemini-3.5-flash-lite", "detail": null, "at": "…" },
  "prometheus": { "state": "up", "restarts": 0, "detail": null }
}
```

`db` and `cluster` are `"up"` or `"down"`. `ok` is always `true` when the API answers. `dryRun` is `true` when healing only records incidents and never touches pods (`REMEDIATION_DRY_RUN`). The frontend polls this every 10 s.

`gemini.state` is the last Gemini call's outcome: `up`, `down` (it failed, so Kairo used its defaults and rule-based causes), `off` (`GEMINI_ENABLED=false` or no key) or `unknown` (no call yet). `model` is the model that last answered, `detail` says why it is down or off, or which model stood in for a busy one, and `at` is when (FR-20).

`prometheus` is the port-forward the backend keeps open to Prometheus (FR-57): `up` (its own forward answers), `external` (someone else's forward answers, e.g. `npm run prom:forward`), `starting`, `down` (kubectl ended; it is started again after 2 s, then up to 30 s apart; `detail` is kubectl's last error) or `off` (`PROMETHEUS_PORT_FORWARD=false`, or `PROMETHEUS_URL` isn't on this machine). `restarts` counts how often it was opened again.

**Changed in P1:** added `dryRun`. **Changed in P4:** added `gemini` and `prometheus`.

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
  "pr": { "state": "OPEN", "number": 3, "url": "https://github.com/PunitXd/kairo-node-sample/pull/3", "error": null, "bot": "kairo-devops[bot]" },
  "facts": {
    "packageManager": { "value": "npm", "source": "rule", "from": "package-lock.json" },
    "nodeVersion": { "value": 22, "source": "default", "from": "no engines.node in package.json" }
  },
  "assumptions": ["The app listens on $PORT (3000) on 0.0.0.0."],
  "release": {
    "id": "cm...",
    "status": "ACTIVE",
    "deployedAt": "2026-11-10T10:35:53.000Z",
    "healthyAt": null,
    "graceEndsAt": "2026-11-10T10:36:53.000Z"
  },
  "configs": [
    { "kind": "DOCKERFILE", "origin": "GENERATED", "path": "Dockerfile", "content": "FROM node:20-slim\n..." }
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
| `stack` | `NODE`, `PYTHON`, or `null` before detection or for a repo with only a Dockerfile |
| `failureReason` | Readable reason when `FAILED`, one line. E.g. `Build failed (docker exited with code 1)` or `App didn't answer on $PORT (3000) within 3 minutes (CrashLoopBackOff)` |
| `logTail` | When the build failed: its last 80 log lines (FR-28). Otherwise `[]` |
| `explanation` | When the build failed: Gemini's plain-English reading of `logTail` (FR-28). `null` for other failures, or when Gemini is off or didn't answer |
| `finishedAt` | `null` while the run is still going. Set when it ends, at `RUNNING` or `FAILED` |
| `configs[].kind` | `DOCKERFILE`, `DEPLOYMENT`, `SERVICE`, `INGRESS`, `WORKFLOW` or `ALERT_RULES` |
| `configs[].origin` | `GENERATED`, or `KEPT_EXISTING` when the repo already had the file (FR-25). A kept Dockerfile is built as it is and left out of the PR |
| `pr.state` | `OPEN`, `MERGED`, `CLOSED`, `FAILED` (with `pr.error`), or `null` before Kairo has tried (FR-34, AQ11). On every deployment |
| `pr.bot` | The account the PR comes from: the GitHub App's bot, `<app slug>[bot]` |
| `facts` | Detail only. Each detected fact: `value`, `source` (`rule` = read from the repo, `gemini` = filled by Gemini and checked against the repo (FR-17 to FR-19), `default`) and `from` (FR-15). For a `gemini` fact, `from` is Gemini's one-line reason |
| `assumptions` | Detail only. What Kairo assumed, also listed in the PR |
| `release` | Detail only. The preview release this run produced: `healthyAt` is set once it passes its 60 s grace window (`graceEndsAt`) (FR-71, FR-72). `null` before `RUNNING` |

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
  "pod": "node-js-getting-started-6d9f8c7b5-x2k4q",
  "cause": "Container went over its memory limit",
  "status": "RESOLVED",
  "explanation": null,
  "startedAt": "2026-11-10T10:48:33.000Z",
  "resolvedAt": "2026-11-10T10:48:56.000Z",
  "recoverySeconds": 23,
  "githubIssueNumber": null,
  "githubIssueUrl": null,
  "attempts": [
    {
      "id": "cmwakhgb40003sa1y2c7pk1ad",
      "action": "RESTART",
      "trigger": "AUTO",
      "dryRun": true,
      "result": "SKIPPED",
      "fromReleaseId": null,
      "toReleaseId": null,
      "fromSha": null,
      "fromSource": null,
      "toSha": null,
      "toSource": null,
      "attemptedAt": "2026-11-10T10:48:33.120Z",
      "verifiedAt": null,
      "reason": "dry run"
    }
  ]
}
```

| Field | Values |
| --- | --- |
| `status` | `OPEN`, `RESOLVED` |
| `alertName` | One of the five Kairo alerts, another alert's name (recorded, no action), or `ManualRollback` for a rollback from the release list (since P4d) |
| `githubIssueNumber`, `githubIssueUrl` | The app's Kairo issue (label `kairo`) this incident opened or commented on, or `null` (since P4d). An issue opens on a rollback or when Kairo stops acting (`NEEDS_ATTENTION`), never for a restart alone; while it is open, every later incident comments on it (FR-55). Only apps added through the GitHub App get issues |
| `pod` | The pod the alert named (its `pod` label), or `null` for an app-level alert (since P3) |
| `recoverySeconds` | Seconds from start to resolve, one decimal; `null` while open |
| `attempts[]` | Oldest first. One per action Kairo took (or chose not to) |
| `attempts[].action` | `RESTART`, `ROLLBACK`, `SCALE_UP`, `SCALE_DOWN`, `NONE` |
| `attempts[].trigger` | `AUTO`, `MANUAL` |
| `attempts[].result` | `APPLIED` (ran, being checked), `VERIFIED` (took effect within 90 s), `UNVERIFIED` (didn't), `FAILED`, `SKIPPED` (dry run, no action for the alert, auto-heal off, given up, mid-rollout) |
| `attempts[].fromReleaseId`, `toReleaseId` | For a rollback: the release rolled away from and the one rolled back to |
| `attempts[].reason` | Why it was `SKIPPED` (e.g. "auto-heal is off", "gave up: 3 attempts in 10 minutes", "a rollout is in progress", "the alert resolved during the grace window, before its deferred action ran"), `UNVERIFIED` ("not confirmed within 90 s: 1 of 2 replicas ready") or `FAILED`; `null` otherwise and for attempts recorded before P3c |
| `attempts[].fromSha`, `toSha`, `fromSource`, `toSource` | Those releases' commits and sources (since P3). Break It's `TEST` release has the commit of the release it replaced |

## GET /api/incidents/:id

One incident for the drawer (Stitch 08): the Incident above plus its app's memory around it. 404 for an unknown id.

```json
{
  "…": "the Incident fields",
  "memory": {
    "startSec": 1762846200, "endSec": 1762846800, "stepSec": 15,
    "limitBytes": 268435456,
    "pod": "kairo-node-sample-76c4f85dc4-fxs5g",
    "pods": [{ "pod": "kairo-node-sample-76c4f85dc4-fxs5g", "points": [[1762846215, 52428800]] }],
    "error": null
  }
}
```

`pods` has each of the app's pods (up to 6, the incident's own `pod` first) from 5 minutes before the alert to 3 minutes after it resolved, or now while it is open, so a restarted pod's replacement shows too. `error` is set when Prometheus didn't answer; Prometheus keeps one day of data, so older incidents have no points.

`explanation` is Gemini's reading of the alert and the pod's last 50 log lines (redacted first), stored a few seconds after the incident opens (FR-53, P4). It stays `null` when Gemini is off or didn't answer; `cause` is always the rule-based one (FR-54).

**Changed in P0:** removed `deploymentId` and `action`. Added `appId`, `explanation`, `githubIssueNumber` and `attempts`. `recoverySeconds` is now stored when the incident resolves instead of being worked out on every request.

## Other values

Not in any response yet, but fixed already:

- App health: `HEALTHY`, `HEALING`, `NEEDS_ATTENTION`
- Release source: `PREVIEW`, `GHCR`
- Release status: `ACTIVE`, `SUPERSEDED`, `ROLLED_BACK`, `FAILED`
