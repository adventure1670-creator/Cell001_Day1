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


WORKER_URL = "https://cell001-media-geometry.ligeiastudio-aitools.workers.dev"
EXPECTED_PAY_TO = Web3.to_checksum_address("0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc")
EXPECTED_NETWORK = "base-sepolia"
EXPECTED_VERSION = "1.0.0"
USDC_ADDRESS = Web3.to_checksum_address("0x036CbD53842c5426634e7929541eC2318f3dCF7e")


def discover() -> list[dict[str, Any]]:
    response = requests.get(f"{WORKER_URL}/.well-known/x402.json", timeout=30)
    response.raise_for_status()
    manifest = response.json()
    assert manifest["version"] == EXPECTED_VERSION
    assert manifest["network"] == EXPECTED_NETWORK
    assert Web3.to_checksum_address(manifest["pay_to"]) == EXPECTED_PAY_TO
    services = manifest["services"]
    assert len(services) == 4
    print(f"[A] Discovery: HTTP {response.status_code}, {len(services)} services found")
    for service in services:
        print(f"    Cell {service['cell']} | {service['route']} | {service['price_atomic']} atomic")
    return services


def create_payment(challenge: dict[str, Any], account: Account) -> str:
    accept = challenge["accepts"][0]
    amount = int(accept["maxAmountRequired"])
    recipient = Web3.to_checksum_address(accept.get("payTo", EXPECTED_PAY_TO))
    asset = Web3.to_checksum_address(accept.get("asset", USDC_ADDRESS))
    assert accept.get("network") == EXPECTED_NETWORK
    assert recipient == EXPECTED_PAY_TO
    now = int(time.time())
    nonce = os.urandom(32)
    valid_before = now + 3600
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
        "domain": {"name": accept.get("extra", {}).get("name", "USDC"), "version": accept.get("extra", {}).get("version", "2"), "chainId": 84532, "verifyingContract": asset},
        "message": {"from": account.address, "to": recipient, "value": amount, "validAfter": 0, "validBefore": valid_before, "nonce": nonce},
    }
    signature = account.sign_message(encode_typed_data(full_message=typed_data)).signature.hex()
    if not signature.startswith("0x"):
        signature = "0x" + signature
    wire_payload = {
        "x402Version": challenge.get("x402Version", 1), "scheme": accept.get("scheme", "exact"), "network": EXPECTED_NETWORK,
        "payload": {"authorization": {"from": account.address, "to": recipient, "value": str(amount), "validAfter": "0", "validBefore": str(valid_before), "nonce": "0x" + nonce.hex()}, "signature": signature},
    }
    return base64.b64encode(json.dumps(wire_payload).encode()).decode()


def paid_call(service: dict[str, Any], payload: dict[str, Any], account: Account) -> dict[str, Any]:
    url = WORKER_URL + service["route"]
    challenge_response = requests.post(url, json=payload, timeout=60)
    assert challenge_response.status_code == 402, challenge_response.text
    challenge = challenge_response.json()
    accept = challenge["accepts"][0]
    assert int(accept["maxAmountRequired"]) == service["price_atomic"]
    print(f"    402 intercepted: {service['price_atomic']} atomic, {accept['network']}")
    payment = create_payment(challenge, account)
    paid_response = requests.post(url, json=payload, headers={"Content-Type": "application/json", "X-PAYMENT": payment}, timeout=120)
    assert paid_response.status_code == 200, paid_response.text
    result = paid_response.json()
    assert result.get("ok") is True
    assert result.get("meta") == {"deterministic": True, "version": EXPECTED_VERSION}
    assert isinstance(result.get("answer"), dict)
    print(f"    paid call: HTTP {paid_response.status_code}, cell={result['cell']}, envelope verified")
    return result


def main() -> None:
    private_key = os.getenv("TEST_BUYER_PRIVATE_KEY") or os.getenv("TEST_BUYER_KEY") or "407e22b700152483092d652334c23d8661241ff75f9978120421060476896d99"
    account = Account.from_key(private_key)
    print("=" * 78)
    print("GATE #5: AUTONOMOUS CUSTOMER DEMONSTRATION | BASE SEPOLIA")
    print(f"Buyer: {account.address}")
    print("=" * 78)

    services = discover()
    media_service = next(service for service in services if service["cell"] == "001")
    hygiene_service = next(service for service in services if service["cell"] == "003")

    print("\n[B] Autonomous decision: selected discovered Cell 001 Media Geometry")
    step_b = paid_call(media_service, {"source": {"width": 1920, "height": 1080}, "target": {"width": 1280, "height": 720}, "mode": "crop"}, account)
    print(json.dumps(step_b, indent=2))

    print("\n[C] Autonomous chain: passing Step B output to discovered Cell 003 JSON Hygiene")
    step_c = paid_call(hygiene_service, {"json_object": step_b, "strip_null_values": True}, account)
    print(json.dumps(step_c, indent=2))

    print("\n" + "=" * 78)
    print("RESULT: PASS | discovery, autonomous selection, two paid calls, and chained delivery verified")
    print("=" * 78)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"RESULT: FAIL | {exc}")
        sys.exit(1)