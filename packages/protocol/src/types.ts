import { z } from "zod";
import type { Address, Hex } from "viem";

export const hexSchema = z.custom<Hex>((v) => typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v));
export const addressSchema = z.custom<Address>(
  (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v),
);
const bigintish = z.union([z.bigint(), z.string(), z.number()]).transform((v) => BigInt(v));

/** What the agent wants to do, in human terms. Derived from `call`, never the source of truth. */
export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("send"), to: addressSchema, valueWei: bigintish, memo: z.string().optional() }),
  z.object({
    kind: z.literal("swap"),
    dex: addressSchema,
    sellWei: bigintish,
    minBuy: bigintish,
    tokenOut: addressSchema,
  }),
  z.object({
    kind: z.literal("buy"),
    merchant: addressSchema,
    valueWei: bigintish,
    invoiceId: z.string(),
    itemName: z.string(),
    shopUrl: z.string(),
  }),
]);
export type Action = z.infer<typeof actionSchema>;

export const PROPOSAL_STATUSES = [
  "PENDING_HUMAN",
  "REJECTED",
  "SUBMITTED",
  "EXECUTED",
  "FAILED",
  "EXPIRED",
] as const;
export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Legal state transitions. Anything else is a bug, not a log line. */
export const ALLOWED_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  PENDING_HUMAN: ["REJECTED", "SUBMITTED", "EXPIRED", "FAILED"],
  REJECTED: [],
  SUBMITTED: ["EXECUTED", "FAILED"],
  EXECUTED: [],
  FAILED: [],
  EXPIRED: [],
};

export const callSchema = z.object({
  to: addressSchema,
  value: bigintish,
  data: hexSchema,
});
export type Call = z.infer<typeof callSchema>;

export const proposalSchema = z.object({
  /** The EIP-712 digest. The id IS the hash, so an id is bound to one exact call. */
  id: hexSchema,
  chainId: z.number(),
  gate: addressSchema,
  nonce: bigintish,
  call: callSchema,
  action: actionSchema,
  /** Unix seconds. The contract rejects execution after this. */
  deadline: z.number(),
  agentSig: hexSchema.optional(),
  humanSig: hexSchema.optional(),
  status: proposalStatusSchema,
  txHash: hexSchema.optional(),
  error: z.string().optional(),
  createdAt: z.number(),
  decidedAt: z.number().optional(),
  originator: z.enum(["chat", "test"]),
});
export type Proposal = z.infer<typeof proposalSchema>;

/** Exactly what the Flipper screen renders. Keep it small: 128x64 pixels. */
export const proposalViewSchema = z.object({
  id: hexSchema,
  short: z.string(),
  action: z.enum(["SEND", "SWAP", "BUY"]),
  amount: z.string(),
  counterparty: z.string(),
  chain: z.string(),
  digest: hexSchema,
});
export type ProposalView = z.infer<typeof proposalViewSchema>;

export const decisionSchema = z.object({
  id: hexSchema,
  approved: z.boolean(),
  humanSig: hexSchema.optional(),
  signer: addressSchema,
  at: z.number(),
});
export type Decision = z.infer<typeof decisionSchema>;

/**
 * The seam that lets two thirds of the team work without touching hardware.
 * MockHumanSigner and FlipperHumanSigner are interchangeable.
 */
export interface HumanSigner {
  address(): Promise<Address>;
  requestApproval(view: ProposalView, timeoutMs: number): Promise<Decision>;
}

/* ---- Approval channel (hub <-> signer process) ---------------------------- */

export const signerKindSchema = z.enum(["mock", "flipper", "flipper-c"]);
export type SignerKind = z.infer<typeof signerKindSchema>;

export const signerHelloSchema = z.object({
  t: z.literal("signer.hello"),
  address: addressSchema,
  kind: signerKindSchema,
});
export const approvalRequestSchema = z.object({
  t: z.literal("approval.request"),
  view: proposalViewSchema,
  timeoutMs: z.number(),
});
export const approvalResultSchema = z.object({
  t: z.literal("approval.result"),
  decision: decisionSchema,
});
export const approvalCancelSchema = z.object({ t: z.literal("approval.cancel"), id: hexSchema });

export const signerToHubSchema = z.discriminatedUnion("t", [signerHelloSchema, approvalResultSchema]);
export const hubToSignerSchema = z.discriminatedUnion("t", [approvalRequestSchema, approvalCancelSchema]);
export type SignerToHub = z.infer<typeof signerToHubSchema>;
export type HubToSigner = z.infer<typeof hubToSignerSchema>;

/* ---- Flipper file protocol (bridge <-> flippy.js) ------------------------- */

export const INBOX_PATH = "/ext/apps_data/flippy/inbox.json";
export const OUTBOX_PATH = "/ext/apps_data/flippy/outbox.json";

export const flipperRequestSchema = proposalViewSchema
  .omit({ digest: true })
  .extend({ seq: z.number() });
export type FlipperRequest = z.infer<typeof flipperRequestSchema>;

export const flipperResponseSchema = z.object({
  id: hexSchema,
  seq: z.number(),
  approved: z.boolean(),
  at: z.number(),
});
export type FlipperResponse = z.infer<typeof flipperResponseSchema>;
