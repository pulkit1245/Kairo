# node-sample

A tiny Node app that Kairo can onboard, with endpoints that make each healing path fire on purpose (FR-64). No dependencies.

| Endpoint | What it does | Fires |
| --- | --- | --- |
| `GET /` | `{ ok, app, heldMb }`. Kairo's liveness and readiness probes hit this | — |
| `GET /work?ms=200` | Burns CPU for `ms` milliseconds (max 2000), in 10 ms slices so health checks still answer | `KairoHighCpu` → scale up |
| `GET /leak` | Keeps another 16 MB each call and never frees it | `KairoOOMKilled` → restart (the limit is 256Mi, so about 15 calls) |

Listens on `$PORT` (default 3000) on `0.0.0.0`.

```bash
npm start
curl localhost:3000/
curl 'localhost:3000/work?ms=500'
curl localhost:3000/leak
```

For the demo this folder is pushed as its own public GitHub repo, because Kairo clones a whole repo and looks for `package.json` in its root.
