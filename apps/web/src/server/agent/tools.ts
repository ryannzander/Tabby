/**
 * SPEC §3.5. The tool definitions and the interface that executes them.
 *
 * These are function-tool definitions run by our own backend, not an MCP server. The definitions
 * and the zod schemas sit side by side on purpose: the Responses API hands `arguments` back as a
 * JSON *string* and will happily send a shape that does not match `parameters`, so every input is
 * parsed and then validated. Never string-match a serialized tool input.
 *
 * `strict: true` requires every property to appear in `required`, so an optional field is written
 * as a nullable type instead of being left out.
 */

import type OpenAI from "openai";
import { z } from "zod";

import { addressSchema, hexSchema, type ProposalStatus } from "@tappy/protocol";

/** A decimal amount in the chain's native coin. Wei and JS numbers both lose money here. */
const decimalAmount = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "must be a decimal string like \"0.01\", not wei and not a number");

export const proposeSendInput = z.object({
  to: addressSchema,
  amountEth: decimalAmount,
  memo: z.string().nullish(),
});

export const proposeSwapInput = z.object({
  sellEth: decimalAmount,
  minTokensOut: decimalAmount.nullish(),
});

export const proposeBuyInput = z.object({ itemId: z.string().min(1) });

export const getProposalInput = z.object({ proposalId: hexSchema });

export const listProposalsInput = z.object({ limit: z.number().int().min(1).max(50).nullish() });

export const getWalletInput = z.object({});

/* ---- what the tools give back --------------------------------------------- */

export interface WalletSummary {
  gate: string;
  chain: string;
  balance: string;
  agent: string;
  human: string;
  /** No device, no proposals. `propose_*` fails loudly rather than queueing. */
  signerConnected: boolean;
}

export interface ProposeResult {
  proposalId: string;
  status: ProposalStatus;
  summary: string;
}

export interface ProposalSummary {
  proposalId: string;
  status: ProposalStatus;
  summary: string;
  txHash?: string;
  error?: string;
}

/**
 * The seam between the loop and everything with side effects. The loop takes one of these, so a
 * test can drive the whole conversation without a database, a chain or a device.
 */
export interface AgentTools {
  get_wallet(): Promise<WalletSummary>;
  propose_send(input: z.infer<typeof proposeSendInput>): Promise<ProposeResult>;
  propose_swap(input: z.infer<typeof proposeSwapInput>): Promise<ProposeResult>;
  propose_buy(input: z.infer<typeof proposeBuyInput>): Promise<ProposeResult>;
  get_proposal(input: z.infer<typeof getProposalInput>): Promise<ProposalSummary>;
  list_proposals(input: z.infer<typeof listProposalsInput>): Promise<ProposalSummary[]>;
}

export type AgentToolName = keyof AgentTools;

/** Parses and validates one tool's arguments, then calls it. One place, so nothing skips zod. */
export const TOOL_SCHEMAS = {
  get_wallet: getWalletInput,
  propose_send: proposeSendInput,
  propose_swap: proposeSwapInput,
  propose_buy: proposeBuyInput,
  get_proposal: getProposalInput,
  list_proposals: listProposalsInput,
} satisfies Record<AgentToolName, z.ZodTypeAny>;

export function isAgentToolName(name: string): name is AgentToolName {
  return name in TOOL_SCHEMAS;
}

/* ---- the definitions the model sees --------------------------------------- */

/**
 * Every `propose_*` description says the tool does not send anything. A model that thinks it is
 * moving money reports success it never got, and the user has no way to tell the difference.
 */
export const TOOL_DEFINITIONS: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "get_wallet",
    description:
      "Read the wallet: gate address, chain, native balance, the agent and human addresses, and " +
      "whether the human's approval device is currently connected. Call this before proposing if " +
      "you are unsure the balance covers the amount.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "propose_send",
    description:
      "Propose sending native currency from the wallet to an address. This does NOT send " +
      "anything. It creates a proposal, shows it on the human's Flipper Zero, and returns a " +
      "proposal id immediately. The human physically approves or rejects it on the device; only " +
      "then does the transaction execute.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient address, 0x-prefixed and 20 bytes." },
        amountEth: {
          type: "string",
          description:
            'Amount in the chain\'s native coin as a decimal string, for example "0.01". Never wei, never a number.',
        },
        memo: {
          type: ["string", "null"],
          description: "Optional short note. The human reads it on the device screen. Null if none.",
        },
      },
      required: ["to", "amountEth", "memo"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "propose_swap",
    description:
      "Propose swapping native currency for tokens on the demo DEX. This does NOT swap anything. " +
      "It creates a proposal for the human to approve on their device and returns a proposal id.",
    parameters: {
      type: "object",
      properties: {
        sellEth: {
          type: "string",
          description: 'Amount of native coin to sell, as a decimal string, for example "0.05".',
        },
        minTokensOut: {
          type: ["string", "null"],
          description:
            "Minimum tokens to accept, as a decimal string. Null to let the server quote it.",
        },
      },
      required: ["sellEth", "minTokensOut"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "propose_buy",
    description:
      "Propose buying an item from the demo shop. This does NOT buy anything. The server looks up " +
      "the invoice and price for the item id; you do not supply an amount. Returns a proposal id " +
      "for the human to approve on their device.",
    parameters: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The shop item id, as shown on the shop page." },
      },
      required: ["itemId"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_proposal",
    description:
      "Read one proposal's current status. PENDING_HUMAN means the human has not decided yet. " +
      "Only EXECUTED means the transaction actually happened.",
    parameters: {
      type: "object",
      properties: {
        proposalId: { type: "string", description: "The proposal id returned by a propose_ tool." },
      },
      required: ["proposalId"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_proposals",
    description: "List recent proposals, newest first, with their statuses.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: ["number", "null"], description: "How many to return, 1 to 50. Null for 20." },
      },
      required: ["limit"],
      additionalProperties: false,
    },
    strict: true,
  },
];
