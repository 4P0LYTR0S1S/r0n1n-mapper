#!/usr/bin/env python3
"""Dev HTTP server for r0n1n-mapper — like `python -m http.server 8770`
but adds Cache-Control: no-store to every response so module edits get
picked up on a plain Ctrl+R (no hard-refresh needed).

Usage:  python3 dev-serve.py [port]
"""

import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
    # ThreadingHTTPServer handles multiple concurrent connections — required
    # because Chrome keeps connections alive and the editor + output tabs
    # both pull modules in parallel.
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer.allow_reuse_port = True
    httpd = http.server.ThreadingHTTPServer(("", port), NoCacheHandler)
    print(f"dev-serve on http://localhost:{port}/ (no cache + threaded)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()
