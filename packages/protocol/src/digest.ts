import { hashTypedData, keccak256, formatUnits } from "viem";
import type { Address, Hex, TypedDataDomain } from "viem";
import type { Action, Call, Proposal, ProposalView } from "./types.js";
import { chainByKey, type ChainInfo } from "./chains.js";

/**
 * The one hash the agent, the human and the contract all sign over.
 * If this disagrees with TappyGate.digestOf(), every execute() reverts.
 * Guarded by the shared vector in vectors/execute.json.
 */
export const EXECUTE_TYPES = {
  Execute: [
    { name: "nonce", type: "uint256" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function domain(chainId: number, gate: Address): TypedDataDomain {
  return { name: "TappyGate", version: "1", chainId, verifyingContract: gate };
}

export interface DigestInput {
  chainId: number;
  gate: Address;
  nonce: bigint;
  call: Call;
  deadline: number;
}

export function proposalDigest(p: DigestInput): Hex {
  return hashTypedData({
    domain: domain(p.chainId, p.gate),
    types: EXECUTE_TYPES,
    primaryType: "Execute",
    message: {
      nonce: p.nonce,
      to: p.call.to,
      value: p.call.value,
      data: p.call.data,
      deadline: BigInt(p.deadline),
    },
  });
}

/** viem hashes `bytes` args as keccak256(data). Exposed so Solidity tests can assert the same. */
export function hashCallData(data: Hex): Hex {
  return keccak256(data);
}

export function shortHex(h: string, lead = 6, tail = 4): string {
  return h.length <= lead + tail + 2 ? h : `${h.slice(0, lead)}…${h.slice(-tail)}`;
}

function amountLabel(wei: bigint, chain: ChainInfo): string {
  const s = formatUnits(wei, chain.nativeDecimals);
  const [whole = "0", frac = ""] = s.split(".");
  return `${whole}.${(frac + "000").slice(0, 3)} ${chain.nativeSymbol}`;
}

/** Everything the human is shown before pressing. Derived only from the proposal. */
export function toView(p: Pick<Proposal, "id" | "action" | "chainId">, chainKey: string): ProposalView {
  const chain = chainByKey(chainKey);
  const a: Action = p.action;
  const [action, amount, counterparty] =
    a.kind === "send"
      ? (["SEND", amountLabel(a.valueWei, chain), shortHex(a.to)] as const)
      : a.kind === "swap"
        ? (["SWAP", amountLabel(a.sellWei, chain), `DEX ${shortHex(a.dex)}`] as const)
        : (["BUY", amountLabel(a.valueWei, chain), `Shop: ${a.itemName}`] as const);

  return {
    id: p.id,
    short: shortHex(p.id, 6, 4),
    action,
    amount,
    counterparty,
    chain: chain.name,
    digest: p.id,
  };
}
