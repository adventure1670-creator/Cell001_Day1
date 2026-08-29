"""Smoke test against a running local FastAPI server."""
import json
import urllib.error
import urllib.request

URL = "http://127.0.0.1:8000/v1/media-geometry"
PAYLOAD = {
    "source": {"width": 1920, "height": 1080},
    "target": {"width": 1080, "height": 1080},
    "mode": "crop",
    "anchor": "center",
}

body = json.dumps(PAYLOAD).encode()
req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json"}, method="POST")
try:
    urllib.request.urlopen(req)
except urllib.error.HTTPError as exc:
    print("status:", exc.code)
    print("PAYMENT-REQUIRED:", bool(exc.headers.get("PAYMENT-REQUIRED")))
else:
    raise SystemExit("Expected 402 from the local demo server")
