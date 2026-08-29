"""Local proof harness. This simulates x402's control flow; it is NOT a blockchain payment."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import base64
import json
import threading
import urllib.error
import urllib.request

from src.geometry import Dimensions, media_geometry

HOST, PORT = "127.0.0.1", 8765
PAYLOAD = {
    "source": {"width": 1920, "height": 1080},
    "target": {"width": 1080, "height": 1080},
    "mode": "crop",
    "anchor": "center",
}

REQUIREMENTS = {
    "x402Version": 2,
    "scheme": "exact",
    "network": "base-sepolia",
    "amount": "1000",  # 0.001 USDC in the smallest unit
    "asset": "USDC",
    "payTo": "0x0000000000000000000000000000000000000000",
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, headers=None):
        raw = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        if self.path != "/v1/media-geometry":
            return self._send(404, {"error": "not found"})

        request_body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        signature = self.headers.get("PAYMENT-SIGNATURE") or self.headers.get("X-PAYMENT-SIGNATURE")

        if signature != "LOCAL_TEST_PAYMENT":
            encoded = base64.b64encode(
                json.dumps({"accepts": [REQUIREMENTS]}, separators=(",", ":")).encode()
            ).decode()
            return self._send(
                402,
                {"error": "payment_required", "accepts": [REQUIREMENTS]},
                {"PAYMENT-REQUIRED": encoded},
            )

        answer = media_geometry(
            Dimensions(request_body["source"]["width"], request_body["source"]["height"]),
            Dimensions(request_body["target"]["width"], request_body["target"]["height"]),
            request_body.get("mode", "crop"),
            request_body.get("anchor", "center"),
        )
        return self._send(200, {"ok": True, "answer": answer, "payment": "LOCAL_TEST_ONLY"})

    def log_message(self, *_args):
        pass


def main():
    server = HTTPServer((HOST, PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        body = json.dumps(PAYLOAD).encode()
        request = urllib.request.Request(
            f"http://{HOST}:{PORT}/v1/media-geometry",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(request)
        except urllib.error.HTTPError as exc:
            assert exc.code == 402
            assert exc.headers.get("PAYMENT-REQUIRED")
            print("PASS 1: unpaid request -> HTTP 402 + PAYMENT-REQUIRED")
        else:
            raise AssertionError("Expected HTTP 402")

        paid_request = urllib.request.Request(
            f"http://{HOST}:{PORT}/v1/media-geometry",
            data=body,
            headers={
                "Content-Type": "application/json",
                "PAYMENT-SIGNATURE": "LOCAL_TEST_PAYMENT",
            },
            method="POST",
        )
        with urllib.request.urlopen(paid_request) as response:
            result = json.load(response)

        assert result["ok"] is True
        assert result["answer"]["crop"] == {"x": 420, "y": 0, "width": 1080, "height": 1080}
        assert result["answer"]["deterministic"] is True
        print("PASS 2: paid retry -> exact deterministic JSON answer")
        print(json.dumps(result, indent=2))
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
