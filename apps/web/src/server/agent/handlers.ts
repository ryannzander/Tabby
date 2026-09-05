/**
 * The tools, wired to the store and the signer.
 *
 * Everything that needs a chain goes through `ChainReader`, which is an interface rather than a
 * viem client because nothing is deployed yet (issue #5). When the deploy lands, someone writes
 * one implementation and no other file changes.
 *
 * The rules enforced here rather than in the model's prompt, because a prompt is not a guard:
 * - No signer connected, no proposal. It fails loudly and never queues.
 * - One proposal pending at a time; the store refuses the second and hands back the first.
 */

import { formatUnits, parseUnits } from "viem";
import type { Address } from "viem";

import { chainByKey, type Action } from "@tappy/protocol";

import type { db as Database } from "~/server/db";
import type { AgentSigner } from "~/server/tappy/agentSigner";
import { buildProposal } from "~/server/tappy/proposals";
import {
  PendingProposalError,
  getProposal,
  insertProposal,
  listProposals,
} from "~/server/tappy/store";
import type {
  AgentTools,
  ProposalSummary,
  ProposeResult,
  WalletSummary,
} from "./tools";

type Db = typeof Database;

/** The chain reads the tools need. One implementation, once something is deployed. */
export interface ChainReader {
  /** `TappyGate.nonce()`. Guessing it produces a proposal that reverts. */
  nonce(): Promise<bigint>;
  /** The gate's native balance, in wei. */
  balance(): Promise<bigint>;
  /** `MockSwap.quote(valueIn)`, used when the model does not name a minimum. */
  quoteSwap(sellWei: bigint): Promise<bigint>;
}

/** The shop's side of `propose_buy`. The server reads the price; the model never supplies one. */
export interface ShopReader {
  item(itemId: string): Promise<{ invoiceId: string; itemName: string; priceWei: bigint; merchant: Address; shopUrl: string } | undefined>;
}

export interface AgentToolDeps {
  db: Db;
  signer: AgentSigner;
  chain: ChainReader;
  shop: ShopReader;
  gate: Address;
  /** The demo DEX and the token it pays out. Required, so a swap cannot quietly target the gate. */
  dex: Address;
  tokenOut: Address;
  chainKey: string;
  /** Whether the bridge is polling. Checked on every propose, not cached. */
  signerConnected: () => Promise<{ connected: boolean; address?: string }>;
  /** How much slippage to allow when the model does not name a minimum. 1% by default. */
  swapSlippageBps?: number;
}

export function createAgentTools(deps: AgentToolDeps): AgentTools {
  const chain = chainByKey(deps.chainKey);
  const decimals = chain.nativeDecimals;
  const slippageBps = BigInt(deps.swapSlippageBps ?? 100);

  /**
   * Building a proposal the human cannot be shown is worse than refusing: the row would sit
   * PENDING_HUMAN, block every later proposal, and expire ten minutes later with no explanation.
   */
  async function requireSigner(): Promise<void> {
    const status = await deps.signerConnected();
    if (!status.connected) {
      throw new Error(
        "No approval device connected. Nothing can be proposed until the human's Flipper is plugged in and the bridge is running.",
      );
    }
  }

  async function propose(action: Action, summary: string): Promise<ProposeResult> {
    await requireSigner();
    const { proposal, view } = await buildProposal(
      {
        action,
        chainId: chain.chainId,
        gate: deps.gate,
        nonce: await deps.chain.nonce(),
        chainKey: deps.chainKey,
        originator: "chat",
      },
      deps.signer,
    );

    try {
      const stored = await insertProposal(deps.db, proposal, view);
      return { proposalId: stored.id, status: stored.status, summary };
    } catch (error) {
      if (error instanceof PendingProposalError) {
        // Tell the model what is already on the device. Retrying would only collide again.
        throw new Error(
          `Proposal ${error.pending.id} (${describe(error.pending.action, chain.nativeSymbol, decimals)}) ` +
            "is already waiting on the human's device. It has to be approved or rejected before another can be made.",
        );
      }
      throw error;
    }
  }

  function summarise(id: string, status: ProposalSummary["status"], text: string): ProposalSummary {
    return { proposalId: id, status, summary: text };
  }

  return {
    async get_wallet(): Promise<WalletSummary> {
      const [balance, signer, agent] = await Promise.all([
        deps.chain.balance(),
        deps.signerConnected(),
        deps.signer.address(),
      ]);
      return {
        gate: deps.gate,
        chain: chain.name,
        balance: `${formatUnits(balance, decimals)} ${chain.nativeSymbol}`,
        agent,
        human: signer.address ?? "unknown",
        signerConnected: signer.connected,
      };
    },

    propose_send(input) {
      const valueWei = parseUnits(input.amountEth, decimals);
      return propose(
        { kind: "send", to: input.to, valueWei, ...(input.memo ? { memo: input.memo } : {}) },
        `Send ${input.amountEth} ${chain.nativeSymbol} to ${input.to}. Waiting on the human's device.`,
      );
    },

    async propose_swap(input) {
      const sellWei = parseUnits(input.sellEth, decimals);
      // A missing minimum is not zero. Zero means "accept any amount of tokens", which is the one
      // thing a swap must never do.
      const minBuy = input.minTokensOut
        ? parseUnits(input.minTokensOut, decimals)
        : ((await deps.chain.quoteSwap(sellWei)) * (10_000n - slippageBps)) / 10_000n;

      return propose(
        {
          kind: "swap",
          dex: deps.dex,
          sellWei,
          minBuy,
          tokenOut: deps.tokenOut,
        },
        `Swap ${input.sellEth} ${chain.nativeSymbol} for at least ${formatUnits(minBuy, decimals)} tokens. Waiting on the human's device.`,
      );
    },

    async propose_buy(input) {
      const item = await deps.shop.item(input.itemId);
      if (!item) throw new Error(`No shop item ${input.itemId}.`);

      return propose(
        {
          kind: "buy",
          merchant: item.merchant,
          valueWei: item.priceWei,
          invoiceId: item.invoiceId,
          itemName: item.itemName,
          shopUrl: item.shopUrl,
        },
        `Buy ${item.itemName} for ${formatUnits(item.priceWei, decimals)} ${chain.nativeSymbol}. Waiting on the human's device.`,
      );
    },

    async get_proposal(input) {
      const p = await getProposal(deps.db, input.proposalId);
      if (!p) throw new Error(`No proposal ${input.proposalId}.`);
      return {
        proposalId: p.id,
        status: p.status,
        summary: describe(p.action, chain.nativeSymbol, decimals),
        ...(p.txHash ? { txHash: p.txHash } : {}),
        ...(p.error ? { error: p.error } : {}),
      };
    },

    async list_proposals(input) {
      const rows = await listProposals(deps.db, input.limit ?? 20);
      return rows.map((p) =>
        summarise(p.id, p.status, describe(p.action, chain.nativeSymbol, decimals)),
      );
    },
  };
}

/** Prose for the model. The human's version of this is `toView`, and it is not this. */
function describe(action: Action, symbol: string, decimals: number): string {
  switch (action.kind) {
    case "send":
      return `Send ${formatUnits(action.valueWei, decimals)} ${symbol} to ${action.to}`;
    case "swap":
      return `Swap ${formatUnits(action.sellWei, decimals)} ${symbol} for at least ${formatUnits(action.minBuy, decimals)} tokens`;
    case "buy":
      return `Buy ${action.itemName} for ${formatUnits(action.valueWei, decimals)} ${symbol}`;
  }
}
