/**
 * Chain facts. Anything marked TODO must be looked up on day 1 and committed.
 * Never guess a chain id or RPC URL.
 */
export interface ChainInfo {
  key: "sepolia" | "arc" | "hedera";
  chainId: number;
  name: string;
  /** Symbol of the native coin. Arc's native coin is USDC, Hedera's is HBAR. */
  nativeSymbol: string;
  nativeDecimals: number;
  rpcEnvVar: string;
  explorerTxUrl: (hash: string) => string;
}

export const SEPOLIA: ChainInfo = {
  key: "sepolia",
  chainId: 11155111,
  name: "Sepolia",
  nativeSymbol: "ETH",
  nativeDecimals: 18,
  rpcEnvVar: "SEPOLIA_RPC_URL",
  explorerTxUrl: (h) => `https://sepolia.etherscan.io/tx/${h}`,
};

export const HEDERA_TESTNET: ChainInfo = {
  key: "hedera",
  chainId: 296,
  name: "Hedera Testnet",
  nativeSymbol: "HBAR",
  nativeDecimals: 18, // JSON-RPC relay exposes 18-decimal wei; HBAR itself has 8
  rpcEnvVar: "HEDERA_RPC_URL",
  explorerTxUrl: (h) => `https://hashscan.io/testnet/transaction/${h}`,
};

/** TODO(day 1, workstream A): confirm chainId, RPC and explorer from Arc's docs. */
export const ARC_TESTNET: ChainInfo = {
  key: "arc",
  chainId: 0, // TODO: look up. Do not deploy until this is real.
  name: "Arc Testnet",
  nativeSymbol: "USDC",
  nativeDecimals: 18, // TODO: confirm. Arc uses USDC for gas.
  rpcEnvVar: "ARC_RPC_URL",
  explorerTxUrl: (h) => `https://explorer.arc.network/tx/${h}`, // TODO: confirm
};

export const CHAINS = { sepolia: SEPOLIA, hedera: HEDERA_TESTNET, arc: ARC_TESTNET } as const;
export type ChainKey = keyof typeof CHAINS;

export function chainByKey(key: string): ChainInfo {
  const c = (CHAINS as Record<string, ChainInfo | undefined>)[key];
  if (!c) throw new Error(`Unknown chain key: ${key}`);
  if (c.chainId === 0) throw new Error(`Chain ${key} has no chainId yet. See chains.ts TODO.`);
  return c;
}
