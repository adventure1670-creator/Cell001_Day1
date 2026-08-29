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


ENDPOINT = "https://cell001-media-geometry.ligeiastudio-aitools.workers.dev/v1/workflow/comfy-preflight"
PAY_TO = Web3.to_checksum_address("0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc")
USDC = Web3.to_checksum_address("0x036CbD53842c5426634e7929541eC2318f3dCF7e")

VALID_WORKFLOW = {
    "prompt": {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "v1-5-pruned.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1], "text": "portrait"}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1], "text": "blurry"}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["4", 0], "steps": 20, "cfg": 7.0}},
    }
}

BROKEN_WORKFLOW = {
    "prompt": {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {}},
        "2": {"class_type": "KSampler", "inputs": {"model": ["99", 0], "positive": [], "negative": None, "latent_image": ["4", 0], "steps": 0, "cfg": -1}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        "6": {"class_type": "MissingCustomNode", "inputs": {"value": 1}},
    }
}


def payment_token(challenge: dict[str, Any], account: Account) -> str:
    accept = challenge["accepts"][0]
    amount = int(accept["maxAmountRequired"])
    recipient = Web3.to_checksum_address(accept.get("payTo", PAY_TO))
    asset = Web3.to_checksum_address(accept.get("asset", USDC))
    now = int(time.time())
    nonce = os.urandom(32)
    valid_before = now + 3600
    typed_data = {
        "types": {
            "EIP712Domain": [{"name": "name", "type": "string"}, {"name": "version", "type": "string"}, {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"}],
            "TransferWithAuthorization": [{"name": "from", "type": "address"}, {"name": "to", "type": "address"}, {"name": "value", "type": "uint256"}, {"name": "validAfter", "type": "uint256"}, {"name": "validBefore", "type": "uint256"}, {"name": "nonce", "type": "bytes32"}],
        },
        "primaryType": "TransferWithAuthorization",
        "domain": {"name": accept.get("extra", {}).get("name", "USDC"), "version": accept.get("extra", {}).get("version", "2"), "chainId": 84532, "verifyingContract": asset},
        "message": {"from": account.address, "to": recipient, "value": amount, "validAfter": 0, "validBefore": valid_before, "nonce": nonce},
    }
    signature = account.sign_message(encode_typed_data(full_message=typed_data)).signature.hex()
    if not signature.startswith("0x"):
        signature = "0x" + signature
    wire = {"x402Version": challenge.get("x402Version", 1), "scheme": accept.get("scheme", "exact"), "network": accept.get("network", "base-sepolia"), "payload": {"authorization": {"from": account.address, "to": recipient, "value": str(amount), "validAfter": "0", "validBefore": str(valid_before), "nonce": "0x" + nonce.hex()}, "signature": signature}}
    return base64.b64encode(json.dumps(wire).encode()).decode()


def assert_success(payload: dict[str, Any], expected_valid: bool, expected_risk: int, expected_codes: set[str]) -> None:
    assert set(payload) == {"ok", "cell", "answer", "meta"}
    assert payload["ok"] is True and payload["cell"] == "comfy_preflight"
    assert payload["meta"] == {"deterministic": True, "version": "1.0.0"}
    answer = payload["answer"]
    assert set(answer) == {"valid", "risk_score", "unresolved_links", "missing_nodes", "issues"}
    assert answer["valid"] is expected_valid and answer["risk_score"] == expected_risk
    assert isinstance(answer["unresolved_links"], list) and isinstance(answer["missing_nodes"], list)
    assert expected_codes.issubset({issue["code"] for issue in answer["issues"]})
    return answer


def run_case(name: str, workflow: dict[str, Any], account: Account, expected_valid: bool, expected_risk: int, expected_codes: set[str]) -> None:
    print(f"\n[{name}]")
    challenge_response = requests.post(ENDPOINT, json=workflow, timeout=60)
    print(f"  challenge: HTTP {challenge_response.status_code}")
    assert challenge_response.status_code == 402
    challenge = challenge_response.json()
    accept = challenge["accepts"][0]
    assert int(accept["maxAmountRequired"]) == 20000
    assert accept["network"] == "base-sepolia"
    assert Web3.to_checksum_address(accept["payTo"]) == PAY_TO
    print(f"  payment: {accept['maxAmountRequired']} atomic | {accept['network']} | payTo verified")
    response = requests.post(ENDPOINT, json=workflow, headers={"Content-Type": "application/json", "X-PAYMENT": payment_token(challenge, account)}, timeout=120)
    payload = response.json()
    print(f"  paid response: HTTP {response.status_code}")
    print(json.dumps(payload, indent=2))
    assert response.status_code == 200
    answer = assert_success(payload, expected_valid, expected_risk, expected_codes)
    print(f"  audit: valid={answer['valid']} risk_score={answer['risk_score']} unresolved_links={len(answer['unresolved_links'])} missing_nodes={len(answer['missing_nodes'])}")
    print("  [PASS] payment, HTTP 200, envelope, and static audit verified")


def main() -> None:
    private_key = os.getenv("TEST_BUYER_PRIVATE_KEY") or os.getenv("TEST_BUYER_KEY") or "407e22b700152483092d652334c23d8661241ff75f9978120421060476896d99"
    account = Account.from_key(private_key)
    print("=" * 78)
    print("GATE #3: COMFYUI PREFLIGHT EDGE PORT & STATIC GRAPH ANALYSIS")
    print(f"Buyer: {account.address}\nEndpoint: {ENDPOINT}")
    print("=" * 78)
    run_case("VALID WORKFLOW", VALID_WORKFLOW, account, True, 0, set())
    run_case("BROKEN WORKFLOW (UNLINKED/DANGLING/MISSING/MODEL ISSUES)", BROKEN_WORKFLOW, account, False, 100, {"MISSING_NODE", "DANGLING_LINK", "UNLINKED_INPUT", "INVALID_CHECKPOINT", "INVALID_MODEL_PARAMETER"})
    print("\n" + "=" * 78)
    print("RESULT: PASS | valid and broken ComfyUI workflows verified")
    print("=" * 78)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[FAIL] {exc}")
        sys.exit(1)