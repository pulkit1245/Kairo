# kairo backend

Express 5, plain JavaScript (ES modules), no build step. `generator/` turns a repo into a running app's files, `remediation/` reacts to Alertmanager alerts. Both share the database (Prisma + PostgreSQL) and the constants in `src/types/`.

## Running it

Needs Node 22+, Docker Desktop and the `kairo-db` Postgres container. The cluster and platform set-up is in [`infra/README.md`](../infra/README.md).

```bash
# Postgres runs in Docker on the Mac, outside the cluster
docker run -d --name kairo-db --restart unless-stopped -p 5432:5432 \
  -e POSTGRES_USER=kairo -e POSTGRES_PASSWORD=kairo -e POSTGRES_DB=kairo postgres:16

cp .env.example .env
npm install                 # also runs prisma generate
npx prisma migrate deploy   # creates the 8 tables
npm run dev
```

Two settings in `.env` come from the platform set-up in `infra/README.md`:

- `KUBECONFIG`: the `kairo-platform` service account's kubeconfig, written by `infra/scripts/kairo-kubeconfig.sh`. The backend then talks to the cluster with only the FR-68 permissions.
- `ALERT_WEBHOOK_TOKEN`: the bearer token Alertmanager sends. The same value goes in `infra/terraform/terraform.tfvars` as `alert_webhook_token`.

`REMEDIATION_DRY_RUN=false` makes healing act for real (restart pods). The top bar's Healing pill shows which mode is on.

`curl localhost:4000/api/health` should say `"db":"up","cluster":"up"`. `cluster` is `down` until Docker Desktop's Kubernetes (kubeadm provisioner, context `docker-desktop`) is running.

The API listens on every interface, not only localhost, because Alertmanager inside the cluster calls it at `http://host.docker.internal:4000/api/alerts`. That endpoint needs the bearer token (FR-45). Every other endpoint needs sign-in (FR-42).

### Public links (P4)

Each running app gets a public link through a Cloudflare quick tunnel (FR-40): one `cloudflared` process per app, started when the app reaches `RUNNING` and for every running app when the backend starts, pointed at Traefik (`TRAEFIK_URL`) with the host header `<slug>.kairo.local`. No Cloudflare account is needed. Install it with `brew install cloudflared`. A tunnel that dies is restarted within 30 s and its new link saved (FR-41); the link changes each time. `TUNNELS_ENABLED=false` turns them off; `CLOUDFLARED_PATH` points at another binary. The code is in `src/tunnel/tunnel.service.js`.

### Gemini (P4)

Gemini fills facts the rules couldn't find (the start file, so far) and explains failed builds and incidents (FR-17 to FR-20, FR-28, FR-53). It never writes files, and Kairo acts on its rules, not on Gemini. Put a key from aistudio.google.com in `GEMINI_API_KEY`; `GEMINI_ENABLED=false` turns every call off and the full loop still works. Calls go through plain `fetch` to `GEMINI_MODEL` (default `gemini-3.8-flash`, the newest Flash model on 11 Nov 2026), then `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`, whose free tier allows 500 requests a day against 20 for the Flash models) when the first is busy, out of quota or slower than `GEMINI_TIMEOUT_MS`. Fact answers and build explanations are cached in the `GeminiAnswer` table per commit sha. Before anything is sent, `.env*` and key files are left out and tokens, keys and passwords are redacted by pattern (`src/gemini/redact.service.js`). The code is in `src/gemini/` and `src/generator/detection/fill.service.js`.

### GitHub issues and manual rollback (P4)

When Kairo rolls an app back, or stops acting on it (`NEEDS_ATTENTION`), it opens an issue labelled `kairo` on the app's repo, as the GitHub App (FR-55). The App needs the Issues (read and write) permission. Each app has at most one open Kairo issue: while it is open, every later incident adds a comment, and once someone closes it the next rollback opens a new one. Restarts alone never open one. The issue is filed after the incident is recorded and after Gemini's explanation (if any), so it never delays an action. Apps added from a pasted URL have no installation and get no issue. The code is in `src/remediation/issue/issue.service.js`.

"Roll back to this" on the release list (`POST /api/apps/:slug/rollback`, FR-61) runs the automatic rollback's path with trigger `MANUAL`, including the grace window and the 90 s check, and is recorded as its own `ManualRollback` incident. It works while the app needs attention and with auto-heal off. See `src/remediation/healing/rollback.service.js`.

### Sign-in and the GitHub App (P2)

Sign-in uses the Kairo GitHub App's user authorization. `.env` needs the App's `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, the path of its private key (`GITHUB_APP_PRIVATE_KEY_PATH`, default `~/.kairo/kairo-github-app.pem`, outside the repo), a `SESSION_SECRET` (`openssl rand -hex 32`) and `ALLOWED_GITHUB_LOGINS`. The App's callback URL is `<APP_URL>/api/auth/callback`, with `APP_URL` defaulting to the Vite dev server, `http://localhost:5173`. Without these the backend still starts, warns, and every endpoint answers 401.

Installation tokens are minted for each request (`src/github/github.client.js` gives Octokit a cache that keeps nothing) and never stored, logged or sent to the browser (FR-5).

## Data model

Nine tables, from PRD section 7 (`prisma/schema.prisma`):

| Table | One row per |
| --- | --- |
| `User`, `Installation` | GitHub user and GitHub App install (used from P2) |
| `App` | Onboarded repo. `slug` is its Kubernetes name and the `app` label on alerts |
| `PipelineRun` | Onboarding run. `finishedAt` is set when it stops, success or failure |
| `GeneratedFile` | Dockerfile, Deployment, Service, … that a run produced |
| `Release` | Image that ran for an app (used from P1) |
| `Incident` | Alert that fired for an app, deduped on Alertmanager's fingerprint |
| `RemediationAttempt` | Action Kairo took for an incident, and how it went |
| `GeminiAnswer` | Gemini answer, cached per commit sha and question (P4) |

Every enum exists three times: `src/types/`, `schema.prisma` and `frontend/src/types/enums.js`. Change all three in one commit, with a migration. `tests/unit/enums.test.js` fails if they drift.

Migrations: `prisma migrate dev` refuses to run without a terminal. To write a migration without one, use `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` and save it under `prisma/migrations/<timestamp>_<name>/migration.sql`, then `npx prisma migrate deploy`.

## Endpoints

Full shapes are in [`docs/api/README.md`](../docs/api/README.md).

| | | |
|---|---|---|
| GET | `/api/auth/login`, `/api/auth/callback`, `/api/auth/install` | Sign-in with the Kairo GitHub App and its install return (browser redirects) |
| GET, POST | `/api/auth/me`, `/api/auth/logout` | Who is signed in; sign out |
| GET | `/api/health` | API, database and cluster status |
| GET | `/api/repos` | Repos your installations can see, for the picker |
| GET | `/api/apps` | The Apps list: live apps with health, pipeline, active release, last incident, public link and live numbers |
| POST | `/api/apps` | `{ "repoFullName": "owner/repo" }` → 202, onboarding from a picked repo |
| GET, PATCH, DELETE | `/api/apps/:slug` | The app page: health, active release, last 10 releases, PR, latest incidents. PATCH `{ "autoHeal": bool }`. DELETE `{ "confirm": "<slug>" }` removes it from the cluster, keeps its history |
| GET | `/api/apps/:slug/metrics` | KPIs and the last 30 minutes from Prometheus (fixed queries) |
| GET | `/api/apps/:slug/logs` | The newest pod's last 50 log lines |
| POST | `/api/apps/:slug/traffic` | Send Traffic: 50 req/s for 60 s through Traefik |
| POST | `/api/apps/:slug/break` | Break It: `{ "kind": "kill-pod" \| "broken-release" }` |
| POST | `/api/apps/:slug/pr` | Try the setup PR again |
| POST | `/api/deployments` | `{ "repoUrl": "https://github.com/owner/repo" }` → 202. Testing shortcut, hidden from the UI |
| GET | `/api/deployments` | Latest 20 pipeline runs |
| GET | `/api/deployments/:id` | One run with its generated files. Poll this while it runs |
| POST | `/api/alerts` | Alertmanager webhook receiver |
| GET | `/api/incidents` | Latest 50 incidents with their remediation attempts |
| GET | `/api/incidents/:id` | One incident with its pods' memory around it (the drawer) |

A run goes `CLONING → DETECTING → GENERATING → BUILDING → DEPLOYING → RUNNING`, or `FAILED` at any step:

- **GENERATING** renders the Dockerfile, Deployment, Service, Ingress and alert rules, and checks every file (FR-26).
- **BUILDING** runs `docker build` with Docker Desktop's engine as `kairo/<slug>:<full sha>`, 10-minute timeout, keeping the last 80 log lines on failure.
- **DEPLOYING** creates namespace `kairo-<slug>`, applies the files (server-side apply) and waits up to 3 minutes for the pods to be ready.
- **RUNNING** writes the app's alert rules into `monitoring/kairo-alert-rules` and records an `ACTIVE` release.

At most 3 apps may be running; a fourth is refused before cloning. The clone is deleted when the run ends.

When the backend starts, it marks runs that never got a `finishedAt` as `FAILED` ("Interrupted"), because the process died mid-run, and empties the clone workspace. Finished runs are left alone. It also rebuilds healing's memory (open incidents, apps) from the database.

Healing acts first and records second (FR-74): it decides from memory, runs the action, then writes the incident. With Postgres stopped, a restart still happens; the failed write is logged.

## Scripts

- `npm run dev`: restarts on file changes (`node --watch`)
- `npm start`: same thing without watching
- `npm test`: unit tests (Node's built-in runner, no jest)
- `npm run db:studio`: look at the tables in a browser
- `npm run prom:forward`: port-forward Prometheus to `localhost:9090` (uses your own kubeconfig)

## Where things live

- `src/types/` (`*.types.js`): the shared contract. Status lists and enums as frozen constants, plus JSDoc shapes for what the API returns.
- `src/models/dto.mapper.js`: database rows to API responses.
- `templates/`: Nunjucks templates for the generated Dockerfile and Kubernetes files.
- Imports need the `.js` extension (`import { x } from './foo.js'`). It's ESM, Node won't guess.
- `REMEDIATION_DRY_RUN=true` (the default) records incidents and attempts but never touches pods.

## File naming

`<name>.<type>.js`, e.g. `deployment.controller.js`, `alert.routes.js`, `error.middleware.js`, `incident.service.js`. Class files are PascalCase (`AppError.js`), small helpers camelCase (`logger.js`). Entry point is `src/index.js`, the Prisma client is `src/db/index.js`.
