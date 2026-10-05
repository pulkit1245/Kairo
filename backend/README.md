# kairo backend

Express, plain JavaScript (ES modules), no build step. `generator/` turns a repo URL into configs, `remediation/` reacts to Alertmanager alerts.

## Running it

Needs Node 22+ and a Postgres.

```bash
# postgres in docker, if you don't have one running
docker run -d --name kairo-db -p 5432:5432 \
  -e POSTGRES_USER=kairo -e POSTGRES_PASSWORD=kairo -e POSTGRES_DB=kairo postgres:16

cp .env.example .env
npm install
npx prisma migrate dev --name init   # first time only, creates the tables
npm run dev
```

`curl localhost:4000/api/health` should say `"db":"up"`. `cluster` stays `down` until minikube is running.

## Endpoints (phase 1)

| | | |
|---|---|---|
| GET | `/api/health` | api / db / cluster status |
| POST | `/api/deployments` | `{ "repoUrl": "https://github.com/owner/repo" }` → 202, pipeline runs in background |
| GET | `/api/deployments` | latest 20 |
| GET | `/api/deployments/:id` | poll this for status + generated configs |
| POST | `/api/alerts` | Alertmanager webhook receiver |
| GET | `/api/incidents` | latest 50 |

Right now a deployment goes `CLONING → DETECTING → GENERATING` and stops there with its configs filled in. Build + deploy is phase 2.

## Scripts

- `npm run dev` - restarts on file changes (`node --watch`)
- `npm start` - same thing without watching
- `npm test` - unit tests (node's built-in runner, no jest)
- `npm run db:studio` - look at the tables in a browser

## Where things live

- `src/types/` (`*.types.js`) - the shared contract: status list, stacks, actions as constants, plus JSDoc shapes for what the API returns. Frontend copies these.
- `templates/` - nunjucks templates for the generated Dockerfile / k8s files.
- Imports need the `.js` extension (`import { x } from './foo.js'`) - it's ESM, node won't guess.
- `REMEDIATION_DRY_RUN=true` (default) records incidents but never touches pods.

## File naming

`<name>.<type>.js` - e.g. `deployment.controller.js`, `alert.routes.js`, `error.middleware.js`, `incident.service.js`. Class files are PascalCase (`AppError.js`), small helpers camelCase (`logger.js`). Entry point is `src/index.js`, the prisma client is `src/db/index.js`.
