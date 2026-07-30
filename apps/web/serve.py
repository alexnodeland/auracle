#!/usr/bin/env python3
"""Static server for the Ricercar web app with caching disabled.

Module workers and wasm imports are NOT reliably refreshed by a browser
hard-refresh when the server sends no cache headers (the heuristic cache
keeps worker.js / pkg/*), which desyncs the UI from the engine protocol.
`Cache-Control: no-store` makes every reload pick up the current build.

Usage: python3 serve.py [port]   (default 8642)
"""

import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with http.server.ThreadingHTTPServer(("", port), NoCacheHandler) as httpd:
        print(f"serving Ricercar on http://localhost:{port} (no-store)")
        httpd.serve_forever()
