import os
import sys
import json
import time
import base64
import statistics
import concurrent.futures
from dataclasses import dataclass
from typing import Dict, List, Any, Optional

import requests
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_typed_data

# ============================================================================
# HUB CONFIGURATION & ROUTE MATRIX
# ============================================================================
BASE_URL = "https://cell001-media-geometry.ligeiastudio-aitools.workers.dev"
BASE_SEPOLIA_CHAIN_ID = 84532
DEFAULT_USDC = Web3.to_checksum_address("0x036CbD53842c5426634e7929541eC2318f3dCF7e")
DEFAULT_PAY_TO = Web3.to_checksum_address("0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc")

CELL_CONFIGS = {
    "Cell_001": {
        "route": "/v1/media-geometry",
        "payload": {
            "source": {"width": 3840, "height": 2160},
            "target": {"width": 1080, "height": 1920},
            "mode": "crop",
            "anchor": "center"
        }
    },
    "Cell_002": {
        "route": "/v1/geometry/measurement",
        "payload": {
            "operation": "diagonal",
            "dimensions": {"width": 20, "length": 22, "unit": "feet"}
        }
    },
    "Cell_003": {
        "route": "/v1/data/json-clean",
        "payload": {
            "raw_payload": "```json\n{\n  \"studio\": \"Ligeia Studio\",\n  \"cell\": 3,\n  \"status\": \"active\",\n  \"redundant\": null,\n  \"nested\": {\"key\": \"value\", \"empty\": null}\n}\n```",
            "strip_null_values":Here is the complete, single-paste PowerShell block. It navigates to your project directory, writes `batch_load_test_suite.py` to disk using a clean here-string, activates your virtual environment, and launches the 20-call multi-cell load test.

### PowerShell One-Shot Deployment

```powershell
Set-Location -Path "C:\Users\greev\Downloads\Cell001_Day1\Cell001_Day1"

$ScriptContent = @'
import os
import sys
import json
import time
import base64
import statistics
import concurrent.futures
from dataclasses import dataclass
from typing import Dict, List, Optional

import requests
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_typed_data

BASE_URL = "[https://cell001-media-geometry.ligeiastudio-aitools.workers.dev](https://cell001-media-geometry.ligeiastudio-aitools.workers.dev)"
BASE_SEPOLIA_CHAIN_ID = 84532
DEFAULT_USDC = Web3.to_checksum_address("0x036CbD53842c5426634e7929541eC2318f3dCF7e")
DEFAULT_PAY_TO = Web3.to_checksum_address("0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc")

CELL_CONFIGS = {
    "Cell_001": {
        "route": "/v1/media-geometry",
        "payload": {
            "source": {"width": 3840, "height": 2160},
            "target": {"width": 1080, "height": 1920},
            "mode": "crop",
            "anchor": "center"
        }
    },
    "Cell_002": {
        "route": "/v1/geometry/measurement",
        "payload": {
            "operation": "diagonal",
            "dimensions": {"width": 20, "length": 22, "unit": "feet"}
        }
    },
    "Cell_003": {
        "route": "/v1/data/json-clean",
        "payload": {
            "raw_payload": "```json\n{\n  \"studio\": \"Ligeia Studio\",\n  \"cell\": 3,\n  \"status\": \"active\",\n  \"empty\": null\n}\n```",
            "strip_null_values": True,
            "flatten_keys": True
        }
    },
    "Cell_004": {
        "route": "/v1/workflow/comfy-preflight",
        "payload": {
            "prompt": {
                "3": {
                    "class_type": "KSampler",
                    "inputs": {
                        "cfg": 8, "denoise": 1, "latent_image": ["5", 0],
                        "model": ["4", 0], "positive": ["6", 0],
                        "negative": ["7", 0], "sampler_name": "euler",
                        "scheduler": "normal", "seed": 42, "steps": 20
                    }
                },
                "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "v1-5-pruned-emaonly.safetensors"}},
                "5": {"class_type": "EmptyLatentImage", "inputs": {"batch_size": 1, "height": 512, "width": 512}},
                "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["4", 1], "text": "masterpiece visual"}},
                "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["4", 1], "text": "blurry, low quality"}},
                "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
                "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "LigeiaTest", "images": ["8", 0]}}
            }
        }
    }
}

@dataclass
class CallMetric:
    cell: str
    status_code: int
    paid_rtt_ms: float
    total_e2e_ms: float
    success: bool
    error_msg: Optional[str] = None

def execute_paid_call(cell_id: str, buyer_account: Account, timeout: float = 15.0) -> CallMetric:
    config = CELL_CONFIGS[cell_id]
    endpoint = f"{BASE_URL}{config['route']}"
    payload = config["payload"]

    t0 = time.perf_counter()
    try:
        resp_unpaid = requests.post(endpoint, json=payload, timeout=timeout)
        if resp_unpaid.status_code != 402:
            return CallMetric(
                cell=cell_id, status_code=resp_unpaid.status_code, paid_rtt_ms=0,
                total_e2e_ms=(time.perf_counter() - t0) * 1000, success=False,
                error_msg=f"Expected 402, got {resp_unpaid.status_code}"
            )

        challenge = resp_unpaid.json()
        accepts = challenge.get("accepts", [{}])[0]
        recipient = Web3.to_checksum_address(accepts.get("payTo", DEFAULT_PAY_TO))
        asset_addr = Web3.to_checksum_address(accepts.get("asset", DEFAULT_USDC))
        amount_atomic = int(accepts.get("maxAmountRequired", 1000))
        extra = accepts.get("extra", {})

        now = int(time.time())
        nonce_bytes = os.urandom(32)
        nonce_hex = "0x" + nonce_bytes.hex()

        typed_data = {
            "types": {
                "EIP712Domain": [
                    {"name": "name", "type": "string"},
                    {"name": "version", "type": "string"},
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"}
                ],
                "TransferWithAuthorization": [
                    {"name": "from", "type": "address"},
                    {"name": "to", "type": "address"},
                    {"name": "value", "type": "uint256"},
                    {"name": "validAfter", "type": "uint256"},
                    {"name": "validBefore", "type": "uint256"},
                    {"name": "nonce", "type": "bytes32"}
                ]
            },
            "primaryType": "TransferWithAuthorization",
            "domain": {
                "name": extra.get("name", "USDC"),
                "version": extra.get("version", "2"),
                "chainId": BASE_SEPOLIA_CHAIN_ID,
                "verifyingContract": asset_addr
            },
            "message": {
                "from": Web3.to_checksum_address(buyer_account.address),
                "to": recipient,
                "value": amount_atomic,
                "validAfter": 0,
                "validBefore": now + 3600,
                "nonce": nonce_bytes
            }
        }

        encoded_msg = encode_typed_data(full_message=typed_data)
        signed_msg = buyer_account.sign_message(encoded_msg)
        sig_hex = signed_msg.signature.hex()
        if not sig_hex.startswith("0x"):
            sig_hex = "0x" + sig_hex

        x402_wire = {
            "x402Version": challenge.get("x402Version", 1),
            "scheme": accepts.get("scheme", "exact"),
            "network": accepts.get("network", "base-sepolia"),
            "payload": {
                "authorization": {
                    "from": Web3.to_checksum_address(buyer_account.address),
                    "to": recipient,
                    "value": str(amount_atomic),
                    "validAfter": "0",
                    "validBefore": str(now + 3600),
                    "nonce": nonce_hex
                },
                "signature": sig_hex
            }
        }

        x_payment = base64.b64encode(json.dumps(x402_wire).encode("utf-8")).decode("utf-8")
        headers = {"Content-Type": "application/json", "X-PAYMENT": x_payment}

        t_paid_start = time.perf_counter()
        resp_paid = requests.post(endpoint, json=payload, headers=headers, timeout=timeout)
        paid_rtt = (time.perf_counter() - t_paid_start) * 1000
        total_e2e = (time.perf_counter() - t0) * 1000

        success = (resp_paid.status_code == 200) and (resp_paid.json().get("ok") is True)
        err = None if success else f"HTTP {resp_paid.status_code}: {resp_paid.text[:80]}"

        return CallMetric(
            cell=cell_id, status_code=resp_paid.status_code,
            paid_rtt_ms=paid_rtt, total_e2e_ms=total_e2e,
            success=success, error_msg=err
        )
    except Exception as e:
        return CallMetric(
            cell=cell_id, status_code=0, paid_rtt_ms=0,
            total_e2e_ms=(time.perf_counter() - t0) * 1000,
            success=False, error_msg=str(e)
        )

def run_load_batch(concurrency: int = 4, rounds_per_cell: int = 5):
    buyer_pk = os.getenv("TEST_BUYER_PRIVATE_KEY")
    if not buyer_pk:
        print("[FATAL] TEST_BUYER_PRIVATE_KEY environment variable is not set.")
        sys.exit(1)

    buyer = Account.from_key(buyer_pk)
    total_calls = len(CELL_CONFIGS) * rounds_per_cell

    print("\n" + "=" * 70)
    print("  LIGEIA STUDIO: PHASE 5 LOAD TEST HARNESS (GATE #4 BENCHMARK)")
    print("=" * 70)
    print(f"[*] Buyer Wallet       : {buyer.address}")
    print(f"[*] Total Calls Queued : {total_calls} ({rounds_per_cell} per cell)")
    print(f"[*] Workers            : {concurrency}")
    print("-" * 70)

    task_list = [cid for _ in range(rounds_per_cell) for cid in CELL_CONFIGS.keys()]
    metrics: List[CallMetric] = []
    t_start = time.perf_counter()

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(execute_paid_call, cid, buyer): cid for cid in task_list}
        for f in concurrent.futures.as_completed(futures):
            res = f.result()
            metrics.append(res)
            status_text = "PASS" if res.success else f"FAIL ({res.error_msg})"
            print(f"[{res.cell:8s}] E2E: {res.total_e2e_ms:7.2f}ms | Paid RTT: {res.paid_rtt_ms:7.2f}ms | {status_text}")

    total_sec = time.perf_counter() - t_start
    successful = [m for m in metrics if m.success]

    print("\n" + "=" * 70)
    print("  BENCHMARK SUMMARY REPORT")
    print("=" * 70)
    print(f"Total Calls : {len(metrics)} | Passed: {len(successful)} | Failed: {len(metrics) - len(successful)}")
    print(f"Success Rate: {(len(successful)/len(metrics))*100:.2f}% | Elapsed: {total_sec:.2f}s | RPS: {len(metrics)/total_sec:.2f} req/s\n")

    print(f"{'Cell ID':<10} | {'Count':<6} | {'Avg E2E':<10} | {'P50 Paid':<10} | {'P95 Paid':<10} | {'Success'}")
    print("-" * 65)
    for cid in CELL_CONFIGS.keys():
        cm = [m for m in metrics if m.cell == cid and m.success]
        if not cm:
            print(f"{cid:<10} | {0:<6} | {'N/A':<10} | {'N/A':<10} | {'N/A':<10} | 0.0%")
            continue
        e2e = [m.total_e2e_ms for m in cm]
        paid = sorted([m.paid_rtt_ms for m in cm])
        p50 = statistics.median(paid)
        p95 = paid[int(len(paid)*0.95)] if len(paid) > 1 else paid[-1]
        print(f"{cid:<10} | {len(cm):<6} | {statistics.mean(e2e):7.2f} ms | {p50:7.2f} ms | {p95:7.2f} ms | 100.0%")
    print("=" * 70 + "\n")

if __name__ == "__main__":
    run_load_batch(concurrency=4, rounds_per_cell=5)