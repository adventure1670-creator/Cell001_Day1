import base64
import json
import os
import sys
import time

import requests
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3


ENDPOINT = "https://cell001-media-geometry.ligeiastudio-aitools.workers.dev/v1/media-geometry"
PAY_TO = Web3.to_checksum_address("0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc")
USDC = Web3.to_checksum_address("0x036CbD53842c5426634e7929541eC2318f3dCF7e")
PAYLOAD = {"source": {"width": 1920, "height": 1080}, "target": {"width": 1280, "height": 720}, "mode": "crop"}


def sign_payment(challenge: dict, account: Account, valid_before: int) -> str:
    accept = challenge["accepts"][0]
    amount = int(accept["maxAmountRequired"])
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
        "domain": {"name": accept.get("extra", {}).get("name", "USDC"), "version": accept.get("extra", {}).get("version", "2"), "chainId": 84532, "verifyingContract": Web3.to_checksum_address(accept.get("asset", USDC))},
        "message": {"from": account.address, "to": PAY_TO, "value": amount, "validAfter": 0, "validBefore": valid_before, "nonce": nonce},
    }
    signature = account.sign_message(encode_typed_data(full_message=typed_data)).signature.hex()
    if not signature.startswith("0x"):
        signature = "0x" + signature
    wire = {
        "x402Version": challenge.get("x402Version", 1), "scheme": accept.get("scheme", "exact"), "network": "base-sepolia",
        "payload": {"authorization": {"from": account.address, "to": PAY_TO, "value": str(amount), "validAfter": "0", "validBefore": str(valid_before), "nonce": "0x" + nonce.hex()}, "signature": signature},
    }
    return base64.b64encode(json.dumps(wire).encode()).decode()


def challenge_for(account: Account) -> tuple[dict, requests.Response]:
    response = requests.post(ENDPOINT, json=PAYLOAD, timeout=60)
    assert response.status_code == 402, response.text
    challenge = response.json()
    accept = challenge["accepts"][0]
    assert int(accept["maxAmountRequired"]) == 3000
    assert accept["network"] == "base-sepolia"
    assert Web3.to_checksum_address(accept["payTo"]) == PAY_TO
    return challenge, response


def assert_success(response: requests.Response) -> None:
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True and payload["cell"] == "media_geometry"
    assert payload["answer"]["scaled_dimensions"] == {"width": 1280, "height": 720}
    assert payload["meta"] == {"deterministic": True, "version": "1.0.0"}


def main() -> None:
    private_key = os.getenv("TEST_BUYER_PRIVATE_KEY") or os.getenv("TEST_BUYER_KEY") or "407e22b700152483092d652334c23d8661241ff75f9978120421060476896d99"
    account = Account.from_key(private_key)
    print("=" * 78)
    print("GATE #7.5: REPLAY & EXPIRED AUTHORIZATION SECURITY TEST | BASE SEPOLIA")
    print(f"Buyer: {account.address}\nEndpoint: {ENDPOINT}")
    print("=" * 78)

    challenge, _ = challenge_for(account)
    fresh_header = sign_payment(challenge, account, int(time.time()) + 3600)
    first = requests.post(ENDPOINT, json=PAYLOAD, headers={"X-PAYMENT": fresh_header}, timeout=120)
    assert_success(first)
    print("[PASS] Vector 1 legitimate fresh payment: HTTP 200, calculation delivered")
    print(f"       Captured X-PAYMENT: {fresh_header[:32]}...{fresh_header[-16:]}")

    replay = requests.post(ENDPOINT, json=PAYLOAD, headers={"X-PAYMENT": fresh_header}, timeout=120)
    assert replay.status_code == 402, replay.text
    print("[PASS] Vector 2 exact signature replay: HTTP 402, replay rejected")

    expired_challenge, _ = challenge_for(account)
    expired_header = sign_payment(expired_challenge, account, int(time.time()) - 3600)
    expired = requests.post(ENDPOINT, json=PAYLOAD, headers={"X-PAYMENT": expired_header}, timeout=120)
    assert expired.status_code == 402, expired.text
    print("[PASS] Vector 3 expired authorization: HTTP 402, expired payment rejected")

    recovery_challenge, _ = challenge_for(account)
    recovery_header = sign_payment(recovery_challenge, account, int(time.time()) + 3600)
    recovery = requests.post(ENDPOINT, json=PAYLOAD, headers={"X-PAYMENT": recovery_header}, timeout=120)
    assert_success(recovery)
    print("[PASS] Vector 4 recovery payment: HTTP 200, calculation delivered")

    print("=" * 78)
    print("RESULT: PASS | 4/4 replay, expiry, and recovery vectors passed")
    print("=" * 78)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"RESULT: FAIL | {exc}")
        sys.exit(1)