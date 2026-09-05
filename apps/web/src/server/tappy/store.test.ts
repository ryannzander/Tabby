import { describe, expect, it } from "vitest";

import { ALLOWED_TRANSITIONS, PROPOSAL_STATUSES, type Proposal } from "@tappy/protocol";

import {
  IllegalTransitionError,
  assertLegalTransition,
  isLegalTransition,
  proposalToRow,
  rowToProposal,
} from "./store";

const view = {
  id: "0xaa" as const,
  short: "0xaa…aa",
  action: "SEND" as const,
  amount: "0.010 ETH",
  counterparty: "0x2222…2222",
  chain: "Sepolia",
  digest: "0xaa" as const,
};

const proposal: Proposal = {
  id: `0x${"ab".repeat(32)}`,
  chainId: 11155111,
  gate: "0x1111111111111111111111111111111111111111",
  // Larger than Number.MAX_SAFE_INTEGER on purpose: this is the value that a numeric column loses.
  nonce: 9_007_199_254_740_993n,
  call: {
    to: "0x2222222222222222222222222222222222222222",
    value: 123_456_789_012_345_678n,
    data: "0x",
  },
  action: { kind: "send", to: "0x2222222222222222222222222222222222222222", valueWei: 123_456_789_012_345_678n },
  deadline: 1_800_000_600,
  agentSig: `0x${"cd".repeat(65)}`,
  status: "PENDING_HUMAN",
  createdAt: 1_800_000_000,
  originator: "chat",
};

describe("the state machine", () => {
  it("allows exactly what ALLOWED_TRANSITIONS lists and nothing else", () => {
    for (const from of PROPOSAL_STATUSES) {
      for (const to of PROPOSAL_STATUSES) {
        expect(isLegalTransition(from, to)).toBe(ALLOWED_TRANSITIONS[from].includes(to));
      }
    }
  });

  it("treats every terminal status as terminal", () => {
    for (const terminal of ["REJECTED", "EXECUTED", "FAILED", "EXPIRED"] as const) {
      for (const to of PROPOSAL_STATUSES) {
        expect(isLegalTransition(terminal, to)).toBe(false);
      }
    }
  });

  // The point of the whole thing: an illegal move stops the process rather than logging.
  it("throws on an illegal move rather than warning", () => {
    expect(() => assertLegalTransition("0xab", "EXECUTED", "REJECTED")).toThrow(
      IllegalTransitionError,
    );
    expect(() => assertLegalTransition("0xab", "PENDING_HUMAN", "EXECUTED")).toThrow(
      /Illegal transition PENDING_HUMAN -> EXECUTED/,
    );
  });

  it("lets a pending proposal reach a decision and a submitted one reach a receipt", () => {
    expect(() => assertLegalTransition("0xab", "PENDING_HUMAN", "SUBMITTED")).not.toThrow();
    expect(() => assertLegalTransition("0xab", "PENDING_HUMAN", "REJECTED")).not.toThrow();
    expect(() => assertLegalTransition("0xab", "SUBMITTED", "EXECUTED")).not.toThrow();
  });
});

describe("row mapping", () => {
  it("round-trips wei that a numeric column would silently round", () => {
    const row = proposalToRow(proposal, view);
    expect(row.nonce).toBe("9007199254740993");
    expect(row.callValue).toBe("123456789012345678");

    const back = rowToProposal({
      ...row,
      seq: 1,
      view,
      claimedAt: null,
      txHash: null,
      error: null,
      humanSig: null,
      decidedAt: null,
      createdAt: new Date(proposal.createdAt * 1000),
      agentSig: row.agentSig ?? null,
    });
    expect(back).toEqual(proposal);
  });

  it("stores action amounts as strings, because jsonb throws on bigint", () => {
    const row = proposalToRow(proposal, view);
    expect(() => JSON.stringify(row.action)).not.toThrow();
  });
});
