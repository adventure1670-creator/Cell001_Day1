import base64
import json
import os
import sys
import requests
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

ENDPOINT = "https://cell001-media-geometry.ligeiastudio-aitools.workers.dev/v1/media-geometry"

# Cell 001 Schema Payload
PAYLOAD = {
    "source": {"width": 1920, "height": 1080},
    "target": {"width": 1280, "height": 720},
    "mode": "crop",
    "anchor": "center"
}

PRIVATE_KEY = os.getenv("TEST_BUYER_KEY", "407e22b700152483092d652334c23d8661241ff75f9978120421060476896d99")
if not PRIVATE_KEY.startswith("0x"):
    PRIVATE_KEY = "0x" + PRIVATE_KEY

def run_test():
    print("=" * 60)
    print("LIGEIA STUDIO — CELL 001 ON-CHAIN PAYMENT TEST")
    print(f"Target Endpoint: {ENDPOINT}")
    print("=" * 60)

    # 1. Unauthenticated Request -> Expect 402
    print("\n[Step 1] Sending unauthenticated request...")
    resp = requests.post(ENDPOINT, json=PAYLOAD)
    print(f"Status Code: {resp.status_code}")

    if resp.status_code != 402:
        print(f"[-] Expected 402 Payment Required, got {resp.status_code}. Response:\n{resp.text}")
        return

    challenge = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    print(f"[+] Received 402 Challenge Payload:\n{json.dumps(challenge, indent=2)}")

    # 2. Extract Settlement Parameters
    accepts_list = challenge.get("accepts", [])
    accept_item = accepts_list[0] if accepts_list else {}

    pay_to = resp.headers.get("x-payment-address") or accept_item.get("payTo") or challenge.get("pay_to") or challenge.get("recipient")
    amount = resp.headers.get("x-payment-amount") or accept_item.get("maxAmountRequired") or challenge.get("amount")
    network = resp.headers.get("x-payment-network") or accept_item.get("network") or challenge.get("network") or "base"
    asset = accept_item.get("asset")

    print(f"\n[Step 2] Extracted Payment Requirements:")
    print(f" - Recipient: {pay_to}")
    print(f" - Amount:    {amount}")
    print(f" - Network:   {network}")
    print(f" - Asset:     {asset}")

    buyer_account = Account.from_key(PRIVATE_KEY)
    print(f" - Buyer Address: {buyer_account.address}")

    # 3. Construct and Sign Payment Authorization
    print("\n[Step 3] Signing payment payload...")
    message_to_sign = {
        "destination": pay_to,
        "amount": amount,
        "network": network,
        "timestamp": int(resp.headers.get("date-timestamp", 0)) or 1724650000
    }

    signable_msg = json.dumps(message_to_sign, sort_keys=True)
    message = encode_defunct(text=signable_msg)
    signed = Account.sign_message(message, private_key=PRIVATE_KEY)

    sig_hex = signed.signature.hex() if hasattr(signed.signature, "hex") else str(signed.signature)
    if not sig_hex.startswith("0x"):
        sig_hex = "0x" + sig_hex

    # Base64-encode the X-PAYMENT header
    payment_obj = {
        "from": buyer_account.address,
        "signature": sig_hex,
        "payload": message_to_sign
    }
    x_payment_header = base64.b64encode(json.dumps(payment_obj).encode("utf-8")).decode("utf-8")

    # 4. Resubmit with X-PAYMENT Header
    print("\n[Step 4] Resubmitting request with Base64-encoded X-PAYMENT header...")
    headers = {
        "Content-Type": "application/json",
        "X-PAYMENT": x_payment_header
    }

    final_resp = requests.post(ENDPOINT, json=PAYLOAD, headers=headers)
    print(f"Final Status Code: {final_resp.status_code}")
    print(f"Final Response Body:\n{final_resp.text}")

    if final_resp.status_code == 200:
        print("\n[+] GATE #1 PASSED: Settlement verified, computation returned.")
    else:
        print(f"\n[-] FAILED with status code {final_resp.status_code}.")

if __name__ == "__main__":
    run_test()