import os
import sys
import json
import time
import base64
import requests
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_typed_data

ENDPOINT_URL = "https://cell001-media-geometry.ligeiastudio-aitools.workers.dev/v1/workflow/comfy-preflight"
BASE_SEPOLIA_RPC = os.getenv("BASE_SEPOLIA_RPC", "https://sepolia.base.org")
BASE_SEPOLIA_CHAIN_ID = 84532

USDC_CONTRACT_ADDRESS = Web3.to_checksum_address("0x036CbD53842c5426634e7929541eC2318f3dCF7e")
RECEIVER_ADDRESS = Web3.to_checksum_address("0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc")

TEST_PAYLOAD = {
    "graph": {
        "1": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["99", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0]
            }
        },
        "2": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["5", 0], "text": "portrait"}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["5", 0], "text": "blurry"}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        "5": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "v1-5-pruned.safetensors"}}
    }
}

def main():
    print("=" * 65)
    print("  CELL 004: LIVE ON-CHAIN PAID TEST (/v1/workflow/comfy-preflight)")
    print("=" * 65)
    
    buyer_pk = os.getenv("TEST_BUYER_PRIVATE_KEY")
    if not buyer_pk:
        print("[ERROR] TEST_BUYER_PRIVATE_KEY is not set.")
        sys.exit(1)
        
    buyer_account = Account.from_key(buyer_pk)
    buyer_address = Web3.to_checksum_address(buyer_account.address)

    # 1. Probe 402
    resp_unpaid = requests.post(ENDPOINT_URL, json=TEST_PAYLOAD)
    if resp_unpaid.status_code != 402:
        print(f"[!] Expected 402, got {resp_unpaid.status_code}: {resp_unpaid.text}")
        sys.exit(1)

    challenge = resp_unpaid.json()
    accepts = challenge["accepts"][0]
    amount_atomic = int(accepts.get("maxAmountRequired", 1000))

    # 2. Sign EIP-3009
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
            "name": "USDC",
            "version": "2",
            "chainId": BASE_SEPOLIA_CHAIN_ID,
            "verifyingContract": USDC_CONTRACT_ADDRESS
        },
        "message": {
            "from": buyer_address,
            "to": RECEIVER_ADDRESS,
            "value": amount_atomic,
            "validAfter": 0,
            "validBefore": now + 3600,
            "nonce": nonce_bytes
        }
    }

    signed_msg = buyer_account.sign_message(encode_typed_data(full_message=typed_data))
    sig_hex = signed_msg.signature.hex()
    if not sig_hex.startswith("0x"):
        sig_hex = "0x" + sig_hex

    x402_wire_payload = {
        "x402Version": 1,
        "scheme": "exact",
        "network": "base-sepolia",
        "payload": {
            "authorization": {
                "from": buyer_address,
                "to": RECEIVER_ADDRESS,
                "value": str(amount_atomic),
                "validAfter": "0",
                "validBefore": str(now + 3600),
                "nonce": nonce_hex
            },
            "signature": sig_hex
        }
    }

    x_payment_token = base64.b64encode(json.dumps(x402_wire_payload).encode("utf-8")).decode("utf-8")

    # 3. Resubmit with X-PAYMENT
    headers = {"Content-Type": "application/json", "X-PAYMENT": x_payment_token}
    start_time = time.perf_counter()
    resp_paid = requests.post(ENDPOINT_URL, json=TEST_PAYLOAD, headers=headers)
    latency_ms = (time.perf_counter() - start_time) * 1000

    print(f"[*] Response Status : {resp_paid.status_code}")
    print(f"[*] Round-Trip Time : {latency_ms:.2f} ms")

    if resp_paid.status_code == 200:
        print("\n[✓] SUCCESS! CELL 004 GRAPH AUDIT DELIVERED:")
        print("=" * 65)
        print(json.dumps(resp_paid.json(), indent=2))
        print("=" * 65)
        print("[PASS] Cell 004 (ComfyUI Workflow Preflight) Verified Live on Cloudflare Edge!")
    else:
        print(f"[!] Request Failed (HTTP {resp_paid.status_code}): {resp_paid.text}")
        sys.exit(1)

if __name__ == "__main__":
    main()
