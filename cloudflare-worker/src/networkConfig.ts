export interface ValidatedNetworkConfig {
  network: string;
  chainId: string;
  usdc: string;
  payTo: string;
}

const MAINNET_CHAIN_ID = "8453";
const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MAINNET_PAY_TO = "0xd38fe438F96C9E21AcdA8d3E9ecE8C4156157dc0";
const SEPOLIA_CHAIN_ID = "84532";
const SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function addressesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function integrityError(message: string): never {
  throw new Error(`CONFIG_INTEGRITY_ERROR: ${message}`);
}

export function resolveNetworkConfig(env: any): ValidatedNetworkConfig {
  const net = String(env?.NETWORK ?? "").trim().toLowerCase();

  if (net === "base") {
    if (!isPresent(env?.CHAIN_ID) || !isPresent(env?.USDC) || !isPresent(env?.PAY_TO)) {
      integrityError("Mainnet configuration mismatch or corruption.");
    }
    const chainId = String(env.CHAIN_ID);
    const usdc = String(env.USDC);
    const payTo = String(env.PAY_TO);
    if (
      chainId.trim() !== MAINNET_CHAIN_ID ||
      !addressesEqual(usdc, MAINNET_USDC) ||
      !addressesEqual(payTo, MAINNET_PAY_TO)
    ) {
      integrityError("Mainnet configuration mismatch or corruption.");
    }
    return { network: "base", chainId, usdc, payTo };
  }

  if (net === "base-sepolia") {
    if (!isPresent(env?.CHAIN_ID) || !isPresent(env?.USDC) || !isPresent(env?.PAY_TO)) {
      integrityError("Sepolia configuration mismatch or missing testnet payTo.");
    }
    const chainId = String(env.CHAIN_ID);
    const usdc = String(env.USDC);
    const payTo = String(env.PAY_TO);
    if (
      chainId.trim() !== SEPOLIA_CHAIN_ID ||
      !addressesEqual(usdc, SEPOLIA_USDC) ||
      addressesEqual(payTo, MAINNET_PAY_TO)
    ) {
      integrityError("Sepolia configuration mismatch or missing testnet payTo.");
    }
    return { network: "base-sepolia", chainId, usdc, payTo };
  }

  integrityError("Unsupported or missing NETWORK environment variable.");
}
