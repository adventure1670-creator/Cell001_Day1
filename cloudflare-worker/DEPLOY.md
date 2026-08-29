# Cloudflare Worker deployment — Cell 001

## 1. Install

From this directory:

```powershell
npm install
```

## 2. Authenticate Wrangler

```powershell
npx wrangler login
```

## 3. Set the receiving test wallet

Edit `wrangler.jsonc` and replace:

```text
REPLACE_WITH_TESTNET_WALLET
```

with the Base Sepolia EVM address that will receive the test USDC.

## 4. Deploy

```powershell
npx wrangler deploy
```

## 5. Test

Use a wallet-backed x402 client. For Base Sepolia, the Cloudflare docs direct developers to the Circle faucet for free test USDC.

Do not put a real-money private key in this project. Keep all test keys testnet-only.
