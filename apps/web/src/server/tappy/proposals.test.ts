import { describe, expect, it } from "vitest";
import { decodeFunctionData, keccak256, recoverTypedDataAddress, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { MockMerchantAbi, MockSwapAbi } from "@tappy/contracts";
import { EXECUTE_TYPES, domain, proposalDigest, type Action } from "@tappy/protocol";

import { LocalAgentSigner } from "./agentSigner";
import {
  PROPOSAL_TTL_SECONDS,
  buildProposal,
  callForAction,
  invoiceIdToBytes32,
} from "./proposals";

/** Anvil account #0. The same well-known test key the frozen vector uses. Public on purpose. */
const AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const GATE = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const DEX = "0x3333333333333333333333333333333333333333" as const;
const MERCHANT = "0x4444444444444444444444444444444444444444" as const;
const TOKEN = "0x5555555555555555555555555555555555555555" as const;
const CHAIN_ID = 11155111;
const NOW = 1_800_000_000;

const send: Action = { kind: "send", to: RECIPIENT, valueWei: 10_000_000_000_000_000n };
const swap: Action = {
  kind: "swap",
  dex: DEX,
  sellWei: 5_000_000_000_000_000n,
  minBuy: 42n,
  tokenOut: TOKEN,
};
const buy: Action = {
  kind: "buy",
  merchant: MERCHANT,
  valueWei: 1_000_000_000_000_000n,
  invoiceId: "inv_0001",
  itemName: "Rubber Duck",
  shopUrl: "http://localhost:3000/shop",
};

describe("callForAction", () => {
  it("sends value with empty calldata", () => {
    expect(callForAction(send)).toEqual({ to: RECIPIENT, value: send.valueWei, data: "0x" });
  });

  it("encodes a swap as swapExactEthForTokens(minOut) with the sell amount as value", () => {
    const call = callForAction(swap);
    expect(call.to).toBe(DEX);
    expect(call.value).toBe(5_000_000_000_000_000n);
    expect(decodeFunctionData({ abi: MockSwapAbi, data: call.data })).toEqual({
      functionName: "swapExactEthForTokens",
      args: [42n],
    });
  });

  it("encodes a buy as pay(invoiceId) with the invoice id hashed to bytes32", () => {
    const call = callForAction(buy);
    expect(call.to).toBe(MERCHANT);
    expect(decodeFunctionData({ abi: MockMerchantAbi, data: call.data })).toEqual({
      functionName: "pay",
      args: [keccak256(stringToHex("inv_0001"))],
    });
  });

  it("hashes invoice ids, so no caller-chosen id can collide with another", () => {
    expect(invoiceIdToBytes32("inv_0001")).not.toBe(invoiceIdToBytes32("inv_0002"));
    expect(invoiceIdToBytes32("inv_0001")).toHaveLength(66);
  });
});

describe("buildProposal", () => {
  const signer = new LocalAgentSigner(AGENT_KEY);
  const input = {
    action: send,
    chainId: CHAIN_ID,
    gate: GATE,
    nonce: 7n,
    chainKey: "sepolia",
    originator: "chat" as const,
    now: NOW,
  };

  it("makes the id the digest of the call it actually built", async () => {
    const { proposal } = await buildProposal(input, signer);
    expect(proposal.id).toBe(
      proposalDigest({
        chainId: CHAIN_ID,
        gate: GATE,
        nonce: 7n,
        call: callForAction(send),
        deadline: NOW + PROPOSAL_TTL_SECONDS,
      }),
    );
  });

  it("sets the deadline ten minutes out and starts PENDING_HUMAN", async () => {
    const { proposal } = await buildProposal(input, signer);
    expect(proposal.deadline).toBe(NOW + 600);
    expect(proposal.status).toBe("PENDING_HUMAN");
  });

  // The gate recovers this address on chain. If it does not match, execute() reverts with
  // BadAgentSig and the revert says nothing about why.
  it("agent-signs the same typed data the gate will verify", async () => {
    const { proposal } = await buildProposal(input, signer);
    const recovered = await recoverTypedDataAddress({
      domain: domain(CHAIN_ID, GATE),
      types: EXECUTE_TYPES,
      primaryType: "Execute",
      message: {
        nonce: proposal.nonce,
        to: proposal.call.to,
        value: proposal.call.value,
        data: proposal.call.data,
        deadline: BigInt(proposal.deadline),
      },
      signature: proposal.agentSig!,
    });
    expect(recovered).toBe(privateKeyToAccount(AGENT_KEY).address);
  });

  it("builds the view from the same proposal, so the screen cannot drift from the digest", async () => {
    const { proposal, view } = await buildProposal(input, signer);
    expect(view.id).toBe(proposal.id);
    expect(view.digest).toBe(proposal.id);
    expect(view.action).toBe("SEND");
    expect(view.amount).toBe("0.010 ETH");
  });

  it("changing only the nonce changes the id", async () => {
    const a = await buildProposal(input, signer);
    const b = await buildProposal({ ...input, nonce: 8n }, signer);
    expect(a.proposal.id).not.toBe(b.proposal.id);
  });

  it("labels a swap and a buy for the device", async () => {
    const s = await buildProposal({ ...input, action: swap }, signer);
    const b = await buildProposal({ ...input, action: buy }, signer);
    expect(s.view.action).toBe("SWAP");
    expect(b.view.action).toBe("BUY");
    expect(b.view.counterparty).toBe("Shop: Rubber Duck");
  });
});
