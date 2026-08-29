"""
Ligeia Studio — Gate #5 Definitive Adversarial Suite
Target: https://cell001-media-geometry.ligeiastudio-aitools.workers.dev
Settlement Asset: Base Sepolia USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e)
"""
import os, sys, json, time, base64
from typing import Tuple, Optional
import requests
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

BASE_URL = "https://cell001-media-geometry.ligeiastudio-aitools.workers.dev"
PAY_TO = Web3.to_checksum_address("0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc")
USDC = Web3.to_checksum_address("0x036CbD53842c5426634e7929541eC2318f3dCF7e")


def make_payment(account: Account, amount: int = 3000, corrupt: bool = False) -> str:
    now = int(time.time())
    nonce = os.urandom(32)
    valid_before = now + 3600
    typed_data = {
        "types": {
            "EIP712Domain": [{"name": "name", "type": "string"}, {"name": "version", "type": "string"}, {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"}],
            "TransferWithAuthorization": [{"name": "from", "type": "address"}, {"name": "to", "type": "address"}, {"name": "value", "type": "uint256"}, {"name": "validAfter", "type": "uint256"}, {"name": "validBefore", "type": "uint256"}, {"name": "nonce", "type": "bytes32"}],
        },
        "primaryType": "TransferWithAuthorization",
        "domain": {"name": "USDC", "version": "2", "chainId": 84532, "verifyingContract": USDC},
        "message": {"from": account.address, "to": PAY_TO, "value": amount, "validAfter": 0, "validBefore": valid_before, "nonce": nonce},
    }
    signature = "0x" + "00" * 65 if corrupt else account.sign_message(encode_typed_data(full_message=typed_data)).signature.hex()
    if not signature.startswith("0x"):
        signature = "0x" + signature
    wire = {"x402Version": 1, "scheme": "exact", "network": "base-sepolia", "payload": {"authorization": {"from": account.address, "to": PAY_TO, "value": str(amount), "validAfter": "0", "validBefore": str(valid_before), "nonce": "0x" + nonce.hex()}, "signature": signature}}
    return base64.b64encode(json.dumps(wire).encode()).decode()


def assert_error(response: requests.Response, status: int) -> None:
    assert response.status_code == status, response.text
    payload = response.json()
    assert set(payload) == {"ok", "error"}
    assert payload["ok"] is False
    assert set(payload["error"]) == {"code", "message", "expected_schema"}


def main() -> None:
    private_key = os.getenv("TEST_BUYER_PRIVATE_KEY") or os.getenv("TEST_BUYER_KEY") or "407e22b700152483092d652334c23d8661241ff75f9978120421060476896d99"
    buyer = Account.from_key(private_key)
    valid_geometry = {"source": {"width": 1920, "height": 1080}, "target": {"width": 1280, "height": 720}}
    print("=" * 78)
    print("GATE #6: ECONOMIC ABUSE & DOS GUARDRAILS | BASE SEPOLIA")
    print(f"Buyer: {buyer.address}")
    print("=" * 78)

    oversized = {"raw_payload": "X" * (512 * 1024 + 1)}
    response = requests.post(f"{BASE_URL}/v1/data/json-clean", json=oversized, timeout=60)
    assert_error(response, 413)
    print(f"[PASS] Test A oversized payload: HTTP {response.status_code}, standardized error envelope")

    malformed = requests.Request("POST", f"{BASE_URL}/v1/data/json-clean", data=b'{"raw_payload": [broken', headers={"Content-Type": "application/json", "X-PAYMENT": make_payment(buyer)}).prepare()
    response = requests.Session().send(malformed, timeout=60)
    assert_error(response, 400)
    print(f"[PASS] Test B malformed JSON: HTTP {response.status_code}, Universal Error Envelope")

    response = requests.post(f"{BASE_URL}/v1/media-geometry", json=valid_geometry, headers={"X-PAYMENT": make_payment(buyer, corrupt=True)}, timeout=60)
    assert response.status_code == 402, response.text
    print(f"[PASS] Test C forged payment signature: HTTP {response.status_code}, payment rejected")

    response = requests.post(f"{BASE_URL}/v1/media-geometry", json=valid_geometry, headers={"Content-Type": "application/json", "X-PAYMENT": make_payment(buyer)}, timeout=120)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True and payload["cell"] == "media_geometry"
    assert payload["meta"] == {"deterministic": True, "version": "1.0.0"}
    print(f"[PASS] Test D valid request recovery: HTTP {response.status_code}, success envelope verified")

    print("=" * 78)
    print("RESULT: PASS | 4/4 economic abuse and DoS guardrail vectors passed")
    print("=" * 78)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"RESULT: FAIL | {exc}")
        sys.exit(1)
