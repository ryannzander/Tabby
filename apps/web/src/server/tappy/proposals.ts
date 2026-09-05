/**
 * Turning what the agent asked for into the exact bytes the human approves.
 *
 * The whole design rests on one thing: the `call` is the truth and the `action` is only a label
 * for it. The digest covers the call, so a proposal that says "send 0.01" in the chat and carries
 * a different `to` in the calldata cannot exist. Anything that builds a call belongs here, and
 * nowhere else, so there is exactly one place to audit.
 */

import { encodeFunctionData, keccak256, stringToHex } from "viem";
import type { Address, Hex } from "viem";

import { MockMerchantAbi, MockSwapAbi } from "@tappy/contracts";
import { proposalDigest, toView, type Action, type Call, type Proposal } from "@tappy/protocol";

import type { AgentSigner } from "./agentSigner";

/** SPEC §2: the human gets ten minutes to press. After that the contract refuses the call. */
export const PROPOSAL_TTL_SECONDS = 600;

/**
 * `MockMerchant.pay` takes a bytes32, and invoice ids are strings the shop makes up. Hashing is
 * the only mapping that cannot collide with a caller-chosen id. The shop must use this same
 * function when it renders the invoice, or the merchant will credit a different one.
 */
export function invoiceIdToBytes32(invoiceId: string): Hex {
  return keccak256(stringToHex(invoiceId));
}

/**
 * The one place an `Action` becomes bytes. Value always rides on the call, never on an approval,
 * because the gate holds the funds and every action here spends native coin.
 */
export function callForAction(action: Action): Call {
  switch (action.kind) {
    case "send":
      return { to: action.to, value: action.valueWei, data: "0x" };
    case "swap":
      return {
        to: action.dex,
        value: action.sellWei,
        data: encodeFunctionData({
          abi: MockSwapAbi,
          functionName: "swapExactEthForTokens",
          args: [action.minBuy],
        }),
      };
    case "buy":
      return {
        to: action.merchant,
        value: action.valueWei,
        data: encodeFunctionData({
          abi: MockMerchantAbi,
          functionName: "pay",
          args: [invoiceIdToBytes32(action.invoiceId)],
        }),
      };
  }
}

export interface BuildProposalInput {
  action: Action;
  chainId: number;
  gate: Address;
  /** Read from `TappyGate.nonce()` by the caller. Guessing it produces a proposal that reverts. */
  nonce: bigint;
  chainKey: string;
  originator: Proposal["originator"];
  /** Unix seconds. Injected so a test can pin it; production leaves it out. */
  now?: number;
}

/**
 * Builds and agent-signs a proposal. It does not persist it and it does not wait for the human:
 * the caller writes the row and returns immediately. See `docs/spikes.md` entry 3.
 */
export async function buildProposal(input: BuildProposalInput, signer: AgentSigner) {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const deadline = now + PROPOSAL_TTL_SECONDS;
  const call = callForAction(input.action);

  const digestInput = {
    chainId: input.chainId,
    gate: input.gate,
    nonce: input.nonce,
    call,
    deadline,
  };
  const id = proposalDigest(digestInput);

  const agentSig = await signer.signProposal(digestInput);

  const proposal: Proposal = {
    id,
    chainId: input.chainId,
    gate: input.gate,
    nonce: input.nonce,
    call,
    action: input.action,
    deadline,
    agentSig,
    status: "PENDING_HUMAN",
    createdAt: now,
    originator: input.originator,
  };

  // Built once here so the device never derives what it renders. What the human sees and what the
  // digest covers come out of the same function call.
  return { proposal, view: toView(proposal, input.chainKey) };
}
