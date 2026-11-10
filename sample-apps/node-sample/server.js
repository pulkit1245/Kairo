// Kairo's Node sample app (FR-64). No dependencies, just node:http.
//   GET /            health check, also what Kairo's liveness probe hits
//   GET /work?ms=200 burns CPU for that long, so KairoHighCpu and scaling fire
//   GET /leak        keeps 16 MB more memory each call, so the OOM path fires
import http from 'node:http';

const PORT = Number(process.env.PORT) || 3000;
const MAX_WORK_MS = 2000;
const LEAK_CHUNK = 16 * 1024 * 1024;

// memory /leak holds on to. never freed, that's the point
const leaked = [];

// Burn CPU in 10 ms slices and let the event loop breathe in between, so the
// liveness probe still gets an answer while /work runs. Otherwise a busy app
// looks dead and Kairo restarts it instead of scaling it.
async function burn(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const slice = Math.min(Date.now() + 10, end);
    while (Date.now() < slice) Math.sqrt(Math.random());
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const heldMb = () => (leaked.length * LEAK_CHUNK) / 2 ** 20;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });

  if (url.pathname === '/') {
    return send(res, 200, { ok: true, app: 'node-sample', heldMb: heldMb() });
  }

  if (url.pathname === '/work') {
    const ms = Math.min(Math.max(Number(url.searchParams.get('ms')) || 200, 1), MAX_WORK_MS);
    const started = Date.now();
    await burn(ms);
    return send(res, 200, { worked: ms, tookMs: Date.now() - started });
  }

  if (url.pathname === '/leak') {
    // Buffer.alloc zero-fills, which really touches the pages, so the
    // container's memory use goes up straight away
    leaked.push(Buffer.alloc(LEAK_CHUNK, 1));
    return send(res, 200, { heldMb: heldMb() });
  }

  send(res, 404, { error: 'not found' });
});

// 0.0.0.0, not localhost: inside a container localhost isn't reachable from outside
server.listen(PORT, '0.0.0.0', () => {
  console.log(`node-sample listening on :${PORT}`);
});

// npm start forwards SIGTERM, so pods stop quickly on a rollout
process.on('SIGTERM', () => server.close(() => process.exit(0)));
