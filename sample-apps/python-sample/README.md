# python-sample

A tiny Python app that Kairo can onboard, with endpoints that make each healing path fire on purpose (FR-64). Standard library only.

| Endpoint | What it does | Fires |
| --- | --- | --- |
| `GET /` | `{ ok, app, heldMb }`. Kairo's liveness and readiness probes hit this | — |
| `GET /work?ms=200` | Burns CPU for `ms` milliseconds (max 2000) | `KairoHighCpu` → scale up |
| `GET /leak` | Keeps another 16 MB each call and never frees it | `KairoOOMKilled` → restart (the limit is 256Mi, so about 15 calls) |

Listens on `$PORT` (default 8000) on `0.0.0.0`. `requirements.txt` is empty but must exist: it's how Kairo recognises a Python project, and `app.py` is how it finds the start command.

```bash
python3 app.py
curl localhost:8000/
curl 'localhost:8000/work?ms=500'
curl localhost:8000/leak
```

For the demo this folder is pushed as its own public GitHub repo, because Kairo clones a whole repo and looks in its root.
