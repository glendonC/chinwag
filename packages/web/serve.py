#!/usr/bin/env python3
"""
Static file server for packages/web. Missing paths return 404.html with status 404
(same as Cloudflare Pages). Use this instead of `python -m http.server`, which
only shows a plain-text error page.

  cd packages/web && python3 serve.py
  PORT=8080 python3 serve.py

Or: npm run dev:web:py  (from repo root)
"""
from __future__ import annotations

import os
import socketserver
from http.server import SimpleHTTPRequestHandler

PORT = int(os.environ.get("PORT", "56790"))
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_error(self, code, message=None, explain=None):
        if code == 404:
            path = os.path.join(ROOT, "404.html")
            try:
                body = self._read_404_body(path)
            except OSError:
                pass
            else:
                self.send_response(404, "Not Found")
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        super().send_error(code, message, explain)

    @staticmethod
    def _read_404_body(path: str) -> bytes:
        with open(path, "rb") as f:
            return f.read()

    def log_message(self, format, *args):
        # Same shape as stdlib; stderr
        message = format % args
        print(f"{self.address_string()} - {message}")


if __name__ == "__main__":
    print(f"chinmeister web  http://localhost:{PORT}  (missing routes → 404.html)")
    print("             Use Ctrl+C to stop.\n")
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()
