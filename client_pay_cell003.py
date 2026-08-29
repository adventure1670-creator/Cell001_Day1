"""
Ligeia Studio — Cell 003 Live Paid Test (Data Hygiene Engine)
Target: https://cell001-media-geometry.ligeiastudio-aitools.workers.dev/v1/data/json-clean
Network: Base Sepolia (Chain ID: 84532)
"""

import os
import sys
import json
import time
import base64
import requests
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_typed_data

ENDPOINT_URL = "https://cell001-media-geometry.ligeiastudio-aitools.workers.dev/v1/data/json-clean"
BASE_SEPOLIA_RPC = os.getenv("BASE_SEPOLIA_RPC", "https://sepolia.base.org")
BASE_SEPOLIA_CHAIN_ID = 84532

USDC_CONTRACT_ADDRESS = Web3.to_checksum_address("0x036CbD53842c5426634e7929541eC2318f3dCF7e")
RECEIVER_ADDRESS = Web3.to_checksum_address("0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc")

TEST_PAYLOAD = {
    "data": {
        "zebra": "   trailing and leading spaces   ",
        "alpha": 999,
        "nested": {
            "zeta": 2,
            "beta": 1
        }
    }
}

def print_section(title: str):
    print(f"\n{'=' * 65}\n  {title}\n{'=' * 65}")

def main():
    print_section("CELL 003: LIVE ON-CHAIN PAID TEST (/v1/data/json-clean)")
    
    buyer_pk = os.getenv("TEST_BUYER_PRIVATE_KEY")
    if not buyer_pk:
        print("[ERROR] TEST_BUYER_PRIVATE_KEY is not set.")
        sys.exit(1)
        
    buyer_account = Account.from_key(buyer_pk)
    buyer_address = Web3.to_checksum_address(buyer_account.address)
    
    print(f"[*] Buyer Wallet : {buyer_address}")
    print(f"[*] Target Route : {ENDPOINT_URL}")

    # Step 1: Probe Unpaid Request (Expect 402)
    print_section("STEP 1: PROBING UNPAID ENDPOINT (EXPECT 402)")
    resp_unpaid = requests.post(ENDPOINT_URL, json=TEST_PAYLOAD)
    print(f"[*] Response Status: {resp_unpaid.status_code}")
    
    if resp_unpaid.status_code != 402:
        print(f"[!] Expected 402, got {resp_unpaid.status_code}: {resp_unpaid.text}")
        sys.exit(1)

    challenge = resp_unpaid.json()
    accepts = challenge["accepts"][0]
    
    scheme = accepts.get("scheme", "exact")
    network = accepts.get("network", "base-sepolia")
    asset_address = Web3.to_checksum_address(accepts.get("asset", USDC_CONTRACT_ADDRESS))
    recipient = Web3.to_checksum_address(accepts.get("payTo", RECEIVER_ADDRESS))
    amount_atomic = int(accepts.get("maxAmountRequired", 1000))
    extra = accepts.get("extra", {})
    token_name = extra.get("name", "USDC")
    token_version = extra.get("version", "2")

    print(f"[✓] 402 Challenge Received:")
    print(f"    - Route Description : {accepts.get('description')}")
    print(f"    - PayTo             : {recipient}")
    print(f"    - Required Amount   : {amount_atomic} atomic units (${amount_atomic / 1e6:.4f} USDC)")

    # Step 2: Sign EIP-3009 TransferWithAuthorization
    print_section("STEP 2: SIGNING EIP-3009 TRANSFER AUTHORIZATION")
    now = int(time.time())
    valid_after = 0
    valid_before = now + 3600
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
            "name": token_name,
            "version": token_version,
            "chainId": BASE_SEPOLIA_CHAIN_ID,
            "verifyingContract": asset_address
        },
        "message": {
            "from": buyer_address,
            "to": recipient,
            "value": amount_atomic,
            "validAfter": valid_after,
            "validBefore": valid_before,
            "nonce": nonce_bytes
        }
    }

    encoded_msg = encode_typed_data(full_message=typed_data)
    signed_msg = buyer_account.sign_message(encoded_msg)
    sig_hex = signed_msg.signature.hex()
    if not sig_hex.startswith("0x"):
        sig_hex = "0x" + sig_hex

    x402_wire_payload = {
        "x402Version": challenge.get("x402Version", 1),
        "scheme": scheme,
        "network": network,
        "payload": {
            "authorization": {
                "from": buyer_address,
                "to": recipient,
                "value": str(amount_atomic),
                "validAfter": str(valid_after),
                "validBefore": str(valid_before),
                "nonce": nonce_hex
            },
            "signature": sig_hex
        }
    }

    raw_json = json.dumps(x402_wire_payload)
    x_payment_token = base64.b64encode(raw_json.encode("utf-8")).decode("utf-8")

    print(f"[✓] Payment Signed. Signature: {sig_hex[:20]}...")

    # Step 3: Resubmit with X-PAYMENT Header
    print_section("STEP 3: EXECUTING PAID INVOCATION (EXPECT 200 OK)")
    headers = {
        "Content-Type": "application/json",
        "X-PAYMENT": x_payment_token
    }

    start_time = time.perf_counter()
    resp_paid = requests.post(ENDPOINT_URL, json=TEST_PAYLOAD, headers=headers)
    latency_ms = (time.perf_counter() - start_time) * 1000

    print(f"[*] Response Status : {resp_paid.status_code}")
    print(f"[*] Round-Trip Time : {latency_ms:.2f} ms")

    if resp_paid.status_code == 200:
        print("\n[✓] SUCCESS! CELL 003 LIVE NORMALIZATION DELIVERED:")
        print("=" * 65)
        print(json.dumps(resp_paid.json(), indent=2))
        print("=" * 65)
        print("[PASS] Cell 003 (Data Hygiene Engine) Verified Live on Cloudflare Edge!")
    else:
        print(f"[!] Request Failed (HTTP {resp_paid.status_code}): {resp_paid.text}")
        sys.exit(1)

if __name__ == "__main__":
    main()
