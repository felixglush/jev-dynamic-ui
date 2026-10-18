"""Local HTTP server around Laya, so the Node app can call it (Laya is a Python library).

    python -m venv .venv-laya && .venv-laya/bin/pip install -r scripts/laya/requirements.txt
    .venv-laya/bin/python scripts/laya/server.py        # http://127.0.0.1:8765, CPU

POST /predict {"text": "...", "questions": {...Laya questions...}} -> Laya's result ({"answers": ...}).
The model loads on the first request and stays in memory.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

from laya import Router

router = Router(device="cpu")


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/predict":
            return self._send(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
            result = router.predict(body["text"], body["questions"])
        except Exception as error:  # report any failure to the caller as JSON
            return self._send(500, {"error": str(error)})
        self._send(200, result)

    def _send(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("LAYA_PORT", "8765"))
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
