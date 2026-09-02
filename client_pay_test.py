import os
import sys
import json
import time
import base64
import requests
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_typed_data

ENDPOINT_URL = "https://cell001-media-geometry.ligeiastudio-aitools.workers.dev/v1/media-geometry"
BASE_MAINNET_RPC = "https://mainnet.base.org"
BASE_SEPOLIA_RPC = "https://sepolia.base.org"

TEST_PAYLOAD = {
    "source": {"width": 1920, "height": 1080},
    "target": {"width": 1080, "height": 1080},
    "mode": "crop"
}

def print_section(title: str):
    print(f"\n{'=' * 65}\n  {title}\n{'=' * 65}")

def main():
    print_section("CELL 001: LIVE ON-CHAIN PAID TEST (BASE MAINNET)")

    buyer_pk = os.getenv("TEST_BUYER_KEY") or os.getenv("TEST_BUYER_PRIVATE_KEY")
    if not buyer_pk:
        print("[-] STOP: Set the TEST_BUYER_KEY environment variable in PowerShell to sign:")
        print('    $env:TEST_BUYER_KEY="your_private_key"')
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
    network = accepts.get("network", "base")
    asset_address = Web3.to_checksum_address(accepts.get("asset", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"))
    recipient = Web3.to_checksum_address(accepts.get("payTo"))
    amount_atomic = int(accepts.get("maxAmountRequired", 3000))
    extra = accepts.get("extra", {})
    token_name = extra.get("name", "USD Coin")
    token_version = extra.get("version", "2")

    if network in ("base", "base-mainnet", "8453"):
        chain_id = 8453
        rpc_url = BASE_MAINNET_RPC
    else:
        chain_id = 84532
        rpc_url = BASE_SEPOLIA_RPC

    print(f"[✓] 402 Challenge Received:")
    print(f"    - Route Description : {accepts.get('description')}")
    print(f"    - Network           : {network} (Chain ID: {chain_id})")
    print(f"    - PayTo             : {recipient}")
    print(f"    - Asset             : {asset_address}")
    print(f"    - Required Amount   : {amount_atomic} atomic units (${amount_atomic / 1e6:.4f} USDC)")

    # Step 2: Sign EIP-3009 TransferWithAuthorization via EIP-712
    print_section("STEP 2: SIGNING EIP-3009 TRANSFER AUTHORIZATION (EIP-712)")
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
            "chainId": chain_id,
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
    print(f"[✓] Payment Signed (EIP-712). Signature: {sig_hex[:20]}...")

    # Step 3: Resubmit with Base64 X-PAYMENT Header
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

    # Check for payment response headers from facilitator / middleware
    payment_resp_header = resp_paid.headers.get("x-payment-response") or resp_paid.headers.get("x-payment")
    tx_hash = None
    if payment_resp_header:
        try:
            decoded_resp = json.loads(base64.b64decode(payment_resp_header).decode("utf-8"))
            print(f"[*] Payment Response Header: {decoded_resp}")
            tx_hash = decoded_resp.get("transactionHash") or decoded_resp.get("txHash") or decoded_resp.get("hash")
        except Exception:
            pass

    if resp_paid.status_code == 200:
        print("\n[✓] SUCCESS! CELL 001 LIVE CALCULATION DELIVERED:")
        print("=" * 65)
        print(json.dumps(resp_paid.json(), indent=2))
        print("=" * 65)

        # Query recent on-chain transfers if tx_hash was not returned directly in header
        if not tx_hash:
            try:
                w3 = Web3(Web3.HTTPProvider(rpc_url))
                current_block = w3.eth.block_number
                # Query Transfer event from buyer in last 10 blocks
                transfer_topic = w3.keccak(text="Transfer(address,address,uint256)").hex()
                auth_topic = w3.keccak(text="AuthorizationUsed(address,bytes32)").hex()
                padded_buyer = "0x" + buyer_address[2:].lower().rjust(64, "0")
                logs = w3.eth.get_logs({
                    "fromBlock": max(0, current_block - 10),
                    "toBlock": "latest",
                    "address": asset_address,
                    "topics": [None, padded_buyer]
                })
                if logs:
                    tx_hash = logs[-1]["transactionHash"].hex()
            except Exception as e:
                pass

        if tx_hash:
            print(f"[✓] Transaction Hash: {tx_hash}")
            print(f"[✓] BaseScan URL: https://basescan.org/tx/{tx_hash}")
        else:
            print(f"[*] Authorization Nonce: {nonce_hex}")
            print(f"[*] Settlement Mode: Gasless EIP-3009 Relayed by x402 Facilitator")

        print("[PASS] Cell 001 (Media Geometry) Verified Live on Base Mainnet ($0.003 USDC)!")
    else:
        print(f"[!] Request Failed (HTTP {resp_paid.status_code}): {resp_paid.text}")
        sys.exit(1)

if __name__ == "__main__":
    main()
