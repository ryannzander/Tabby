import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import vector from "../vectors/execute.json" with { type: "json" };
import { EXECUTE_TYPES, domain, hashCallData, proposalDigest, shortHex, toView } from "../src/digest.js";
import { ALLOWED_TRANSITIONS, proposalSchema } from "../src/types.js";
import type { Address, Hex } from "viem";

interface Vector {
  chainId: number;
  gate: string;
  nonce: string;
  to: string;
  value: string;
  data: string;
  deadline: string;
  dataHash: string;
  digest: string;
  agentAddress: string;
  agentSig: string;
  humanAddress: string;
  humanSig: string;
}
const v = vector as unknown as Vector;

describe("EIP-712 digest", () => {
  it("reproduces the frozen vector that Solidity also asserts", () => {
    const digest = proposalDigest({
      chainId: v.chainId,
      gate: v.gate as Address,
      nonce: BigInt(v.nonce),
      call: { to: v.to as Address, value: BigInt(v.value), data: v.data as Hex },
      deadline: Number(v.deadline),
    });
    expect(digest).toBe(v.digest);
  });

  it("hashes calldata the way the contract does", () => {
    expect(hashCallData(v.data as Hex)).toBe(v.dataHash);
  });

  it("recovers both signers from the vector signatures", async () => {
    const args = {
      domain: domain(v.chainId, v.gate as Address),
      types: EXECUTE_TYPES,
      primaryType: "Execute" as const,
      message: {
        nonce: BigInt(v.nonce),
        to: v.to as Address,
        value: BigInt(v.value),
        data: v.data as Hex,
        deadline: BigInt(v.deadline),
      },
    };
    expect(await recoverTypedDataAddress({ ...args, signature: v.agentSig as Hex })).toBe(v.agentAddress);
    expect(await recoverTypedDataAddress({ ...args, signature: v.humanSig as Hex })).toBe(v.humanAddress);
  });

  it("changes when any field changes", () => {
    const base = {
      chainId: v.chainId,
      gate: v.gate as Address,
      nonce: BigInt(v.nonce),
      call: { to: v.to as Address, value: BigInt(v.value), data: v.data as Hex },
      deadline: Number(v.deadline),
    };
    expect(proposalDigest({ ...base, nonce: 1n })).not.toBe(v.digest);
    expect(proposalDigest({ ...base, deadline: base.deadline + 1 })).not.toBe(v.digest);
  });
});

describe("view rendering", () => {
  it("shortens hex for the 128x64 screen", () => {
    expect(shortHex("0x1234567890abcdef1234")).toBe("0x1234…1234");
  });

  it("renders a send the human can read", () => {
    const view = toView(
      {
        id: v.digest as Hex,
        chainId: v.chainId,
        action: { kind: "send", to: v.to as Address, valueWei: BigInt(v.value) },
      },
      "sepolia",
    );
    expect(view.action).toBe("SEND");
    expect(view.amount).toBe("0.010 ETH");
    expect(view.chain).toBe("Sepolia");
    expect(view.counterparty).toBe("0x2222…2222");
  });
});

describe("proposal state machine", () => {
  it("treats terminal states as terminal", () => {
    for (const s of ["EXECUTED", "REJECTED", "FAILED", "EXPIRED"] as const) {
      expect(ALLOWED_TRANSITIONS[s]).toEqual([]);
    }
  });

  it("parses a proposal and coerces bigint-ish fields", () => {
    const p = proposalSchema.parse({
      id: v.digest,
      chainId: v.chainId,
      gate: v.gate,
      nonce: "0",
      call: { to: v.to, value: v.value, data: v.data },
      action: { kind: "send", to: v.to, valueWei: v.value },
      deadline: Number(v.deadline),
      status: "PENDING_HUMAN",
      createdAt: 1,
      originator: "chat",
    });
    expect(p.nonce).toBe(0n);
    expect(p.call.value).toBe(10000000000000000n);
  });
});
