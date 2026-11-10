"""Kairo's Python sample app (FR-64). Standard library only.

  GET /            health check, also what Kairo's liveness probe hits
  GET /work?ms=200 burns CPU for that long, so KairoHighCpu and scaling fire
  GET /leak        keeps 16 MB more memory each call, so the OOM path fires
"""

import json
import os
import signal
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("PORT", "8000"))
MAX_WORK_MS = 2000
LEAK_CHUNK = 16 * 1024 * 1024

# memory /leak holds on to. never freed, that's the point
leaked = []


def held_mb():
    return len(leaked) * LEAK_CHUNK / 2**20


def burn(ms):
    # one thread per request, and the interpreter switches threads every few
    # milliseconds, so the health check still answers while this runs
    end = time.monotonic() + ms / 1000
    while time.monotonic() < end:
        sum(i * i for i in range(1000))


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)

        if url.path == "/":
            return self.send_json(200, {"ok": True, "app": "python-sample", "heldMb": held_mb()})

        if url.path == "/work":
            try:
                ms = int(parse_qs(url.query).get("ms", ["200"])[0])
            except ValueError:
                ms = 200
            ms = min(max(ms, 1), MAX_WORK_MS)
            started = time.monotonic()
            burn(ms)
            took = round((time.monotonic() - started) * 1000)
            return self.send_json(200, {"worked": ms, "tookMs": took})

        if url.path == "/leak":
            # bytes([1]) * n writes every byte, so the memory is really used.
            # a plain bytearray(n) can stay as untouched zero pages
            leaked.append(b"\x01" * LEAK_CHUNK)
            return self.send_json(200, {"heldMb": held_mb()})

        self.send_json(404, {"error": "not found"})

    # one short line per request instead of the default noisy format
    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))


def main():
    # 0.0.0.0, not localhost: inside a container localhost isn't reachable from outside
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    # the container runs python as PID 1, which ignores SIGTERM unless handled
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    print(f"python-sample listening on :{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
