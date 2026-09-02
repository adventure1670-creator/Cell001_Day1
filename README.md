# Cell 001 — Day 1 x402 Proof-of-Concept

**Cell 001** is a deterministic Media Geometry Engine. It is deliberately small: no AI model, no GPU, and no ComfyUI runtime.

## What we can prove locally

- deterministic crop/contain calculations
- repeatability through unit tests
- a local HTTP 402 challenge
- a local paid-retry control flow

`local_proof.py` is a **simulation only**. It does not move USDC.

## Real Base Sepolia path

Cloudflare's current x402 documentation supports `base-sepolia` for testing, `x402-hono` for Worker-side HTTP payment gating, and the public facilitator at `https://x402.org/facilitator`. The client side uses a wallet and test USDC. See:

- https://developers.cloudflare.com/agents/tools/payments/x402/
- https://developers.cloudflare.com/agents/tools/payments/x402/charge-for-http-content/
- https://developers.cloudflare.com/agents/tools/payments/x402/pay-from-agents-sdk/

### What is still required on the Dell

1. A **testnet-only EVM wallet** whose private key can be stored locally for this experiment.
2. Test USDC on **Base Sepolia** from the Circle faucet.
3. A Cloudflare account for Worker deployment.
4. `npm install` in ` on the sidebar` and `npx wrangler deploy`.

**Never use a real-money wallet/private key for this test.**

## Local test

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest -q tests/test_geometry.py
python local_proof.py
```

Expected local result:

```text
PASS 1: unpaid request -> HTTP 402 + PAYMENT-REQUIRED
PASS 2: paid retry -> exact deterministic JSON answer
```

## Real x402 test target

Once the Worker is deployed with a Base Sepolia test wallet as `PAY_TO`, the target flow is:

```text
AI/client
   -> POST /v1/media-geometry
   <- 402 + PAYMENT-REQUIRED
   -> signed test-USDC payment
   -> retry with PAYMENT-SIGNATURE
   <- 200 + JSON answer + PAYMENT-RESPONSE
```

This is the only milestone to complete before we begin the ComfyUI Workflow Integrity Engine.
