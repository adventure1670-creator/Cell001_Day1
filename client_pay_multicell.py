import base64
import json
import os
import sys
import time
from typing import Any

import requests
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3


BASE_URL = "https://cell001-media-geometry.ligeiastudio-aitools.workers.dev"
CHAIN_ID = 84532
USDC = Web3.to_checksum_address("0x036CbD53842c5426634e7929541eC2318f3dCF7e")
PAY_TO = Web3.to_checksum_address("0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc")

CASES = [
    ("Cell 001", "/v1/media-geometry", {"source": {"width": 1920, "height": 1080}, "target": {"width": 1280, "height": 720}, "mode": "crop"}, 3000, "media_geometry"),
    ("Cell 002", "/v1/geometry/measurement", {"operation": "diagonal", "dimensions": {"width": 20, "length": 22, "unit": "feet"}}, 3000, "geometric_measurement"),
    ("Cell 003", "/v1/data/json-clean", {"json_object": {"z": None, "a": 1}, "strip_null_values": True}, 3000, "data_hygiene"),
    ("Cell 004", "/v1/workflow/comfy-preflight", {"prompt": {"1": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512}}}}, 20000, "comfy_preflight"),
]


def sign_payment(challenge: dict[str, Any], account: Account, amount: int) -> str:
    accepts = challenge["accepts"][0]
    asset = Web3.to_checksum_address(accepts.get("asset", USDC))
    recipient = Web3.to_checksum_address(accepts.get("payTo", PAY_TO))
    network = accepts.get("network", "base-sepolia")
    now = int(time.time())
    valid_before = now + 3600
    nonce = os.urandom(32)
    typed_data = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"}, {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"},
            ],
            "TransferWithAuthorization": [
                {"name": "from", "type": "address"}, {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"}, {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore", "type": "uint256"}, {"name": "nonce", "type": "bytes32"},
            ],
        },
        "primaryType": "TransferWithAuthorization",
        "domain": {"name": accepts.get("extra", {}).get("name", "USDC"), "version": accepts.get("extra", {}).get("version", "2"), "chainId": CHAIN_ID, "verifyingContract": asset},
        "message": {"from": account.address, "to": recipient, "value": amount, "validAfter": 0, "validBefore": valid_before, "nonce": nonce},
    }
    signature = account.sign_message(encode_typed_data(full_message=typed_data)).signature.hex()
    if not signature.startswith("0x"):
        signature = "0x" + signature
    payment = {
        "x402Version": challenge.get("x402Version", 1), "scheme": accepts.get("scheme", "exact"), "network": network,
        "payload": {"authorization": {"from": account.address, "to": recipient, "value": str(amount), "validAfter": "0", "validBefore": str(valid_before), "nonce": "0x" + nonce.hex()}, "signature": signature},
    }
    return base64.b64encode(json.dumps(payment).encode()).decode()


def verify_envelope(payload: Any, cell: str) -> None:
    if not isinstance(payload, dict) or set(payload) != {"ok", "cell", "answer", "meta"}:
        raise AssertionError("top-level keys do not exactly match the Universal Success Envelope")
    if payload["ok"] is not True or payload["cell"] != cell or not isinstance(payload["answer"], dict):
        raise AssertionError("ok, cell, or answer has the wrong type/value")
    if payload["meta"] != {"deterministic": True, "version": "1.0.0"}:
        raise AssertionError("meta does not exactly match deterministic/version contract")


def main() -> None:
    private_key = os.getenv("TEST_BUYER_PRIVATE_KEY") or os.getenv("TEST_BUYER_KEY") or "407e22b700152483092d652334c23d8661241ff75f9978120421060476896d99"
    account = Account.from_key(private_key)
    print("=" * 78)
    print("GATE #2: PRODUCT CATALOG & SCHEMA STANDARDIZATION | BASE SEPOLIA")
    print(f"Buyer: {account.address}\nEndpoint base: {BASE_URL}")
    print("=" * 78)

    failures = 0
    for name, route, request_body, expected_amount, expected_cell in CASES:
        print(f"\n[{name}] {route} | expected price: {expected_amount} atomic units")
        try:
            unpaid = requests.post(BASE_URL + route, json=request_body, timeout=60)
            print(f"  challenge: HTTP {unpaid.status_code}")
            assert unpaid.status_code == 402, f"expected HTTP 402 challenge, got {unpaid.status_code}: {unpaid.text}"
            challenge = unpaid.json()
            accepts = challenge["accepts"][0]
            assert int(accepts["maxAmountRequired"]) == expected_amount
            assert accepts.get("network") == "base-sepolia"
            assert Web3.to_checksum_address(accepts["payTo"]) == PAY_TO
            print(f"  payment: {accepts['maxAmountRequired']} atomic | {accepts['network']} | payTo verified")
            paid = requests.post(BASE_URL + route, json=request_body, headers={"Content-Type": "application/json", "X-PAYMENT": sign_payment(challenge, account, expected_amount)}, timeout=120)
            payload = paid.json()
            print(f"  paid response: HTTP {paid.status_code}")
            print(json.dumps(payload, indent=2))
            assert paid.status_code == 200
            verify_envelope(payload, expected_cell)
            print("  [PASS] HTTP 200 and Universal Success Envelope verified")
        except Exception as exc:
            failures += 1
            print(f"  [FAIL] {exc}")

    print("\n" + "=" * 78)
    print(f"RESULT: {'PASS' if failures == 0 else 'FAIL'} | {len(CASES) - failures}/{len(CASES)} cells verified")
    print("=" * 78)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()