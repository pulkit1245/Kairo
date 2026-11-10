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

`curl localhost:4000/api/health` should say `"db":"up","cluster":"up"`. `cluster` is `down` until Docker Desktop's Kubernetes (kubeadm provisioner, context `docker-desktop`) is running.

The API listens on every interface, not only localhost, because Alertmanager inside the cluster calls it at `http://host.docker.internal:4000/api/alerts`. Sign-in and an alert token arrive in P1 and P2 (FR-42, FR-45).

## Data model

Eight tables, from PRD section 7 (`prisma/schema.prisma`):

| Table | One row per |
| --- | --- |
| `User`, `Installation` | GitHub user and GitHub App install (used from P2) |
| `App` | Onboarded repo. `slug` is its Kubernetes name and the `app` label on alerts |
| `PipelineRun` | Onboarding run. `finishedAt` is set when it stops, success or failure |
| `GeneratedFile` | Dockerfile, Deployment, Service, … that a run produced |
| `Release` | Image that ran for an app (used from P1) |
| `Incident` | Alert that fired for an app, deduped on Alertmanager's fingerprint |
| `RemediationAttempt` | Action Kairo took for an incident, and how it went |

Every enum exists three times: `src/types/`, `schema.prisma` and `frontend/src/types/enums.js`. Change all three in one commit, with a migration. `tests/unit/enums.test.js` fails if they drift.

Migrations: `prisma migrate dev` refuses to run without a terminal. To write a migration without one, use `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` and save it under `prisma/migrations/<timestamp>_<name>/migration.sql`, then `npx prisma migrate deploy`.

## Endpoints

Full shapes are in [`docs/api/README.md`](../docs/api/README.md).

| | | |
|---|---|---|
| GET | `/api/health` | API, database and cluster status |
| POST | `/api/deployments` | `{ "repoUrl": "https://github.com/owner/repo" }` → 202, the pipeline runs in the background |
| GET | `/api/deployments` | Latest 20 pipeline runs |
| GET | `/api/deployments/:id` | One run with its generated files. Poll this while it runs |
| POST | `/api/alerts` | Alertmanager webhook receiver |
| GET | `/api/incidents` | Latest 50 incidents with their remediation attempts |

A run currently goes `CLONING → DETECTING → GENERATING` and stops there with its files saved. Build and deploy come in P1.

When the backend starts, it marks runs that never got a `finishedAt` as `FAILED` ("Interrupted"), because the process died mid-run. Finished runs are left alone.

## Scripts

- `npm run dev`: restarts on file changes (`node --watch`)
- `npm start`: same thing without watching
- `npm test`: unit tests (Node's built-in runner, no jest)
- `npm run db:studio`: look at the tables in a browser

## Where things live

- `src/types/` (`*.types.js`): the shared contract. Status lists and enums as frozen constants, plus JSDoc shapes for what the API returns.
- `src/models/dto.mapper.js`: database rows to API responses.
- `templates/`: Nunjucks templates for the generated Dockerfile and Kubernetes files.
- Imports need the `.js` extension (`import { x } from './foo.js'`). It's ESM, Node won't guess.
- `REMEDIATION_DRY_RUN=true` (the default) records incidents and attempts but never touches pods.

## File naming

`<name>.<type>.js`, e.g. `deployment.controller.js`, `alert.routes.js`, `error.middleware.js`, `incident.service.js`. Class files are PascalCase (`AppError.js`), small helpers camelCase (`logger.js`). Entry point is `src/index.js`, the Prisma client is `src/db/index.js`.
