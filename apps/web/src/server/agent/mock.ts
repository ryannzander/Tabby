/**
 * The demo with no chain, no device and no API key.
 *
 * Three things are missing and none of them are our code: nothing is deployed (issue #5), the
 * Flipper spike is unrun (issue #1), and there is no OpenAI budget. This file stands in for all
 * three so the rest of the app can be built and shown. Every real implementation swaps in behind
 * the same interface, and nothing outside this file knows the difference.
 *
 * THIS IS NOT AN AI AND IT IS NOT A BLOCKCHAIN. `ScriptedResponses` matches keywords; it does not
 * reason about anything. `MockChainReader` makes its numbers up. Anything demonstrated on top of
 * this is a demonstration of the plumbing, which is real, and not of the model, which is not
 * running. Say so out loud if this is what is on screen in front of judges.
 *
 * Reached only through `AGENT_MODE=mock`, which is opt-in. The default is `live`, so a machine
 * that is meant to be talking to a real chain fails loudly instead of quietly inventing a balance.
 */

import { count, eq, sql } from "drizzle-orm";
import type OpenAI from "openai";
import type { Address } from "viem";

import type { db as Database } from "~/server/db";
import { proposals } from "~/server/db/schema";

import type { ChainReader, ShopReader } from "./handlers";
import type { ResponsesClient } from "./loop";

type Db = typeof Database;

/* ---- the addresses nothing is deployed at --------------------------------- */

/**
 * Recognisable on sight. A real deployed address is a random-looking hex string, so if one of
 * these turns up in a proposal on a machine that is supposed to be talking to Sepolia, the repeated
 * digits say what happened faster than any error message would.
 */
export const MOCK_GATE = "0x1111111111111111111111111111111111111111" as Address;
export const MOCK_DEX = "0x2222222222222222222222222222222222222222" as Address;
export const MOCK_TOKEN = "0x3333333333333333333333333333333333333333" as Address;
export const MOCK_MERCHANT = "0x4444444444444444444444444444444444444444" as Address;

/** What the gate "holds". Enough for the demo to spend from without hitting zero. */
export const MOCK_START_BALANCE_WEI = 490_000_000_000_000_000n; // 0.49

/** The mock DEX pays this many token units per whole unit of native coin. */
export const MOCK_SWAP_RATE = 2000n;

/* ---- the chain ------------------------------------------------------------ */

export class MockChainReader implements ChainReader {
  constructor(private readonly db: Db) {}

  /**
   * Every proposal ever written, not just the executed ones.
   *
   * A real `TappyGate.nonce()` only moves on execution, but here the nonce's only job is to make
   * each digest unique. Counting executions instead would give a rejected proposal and its
   * identical retry the same digest, and the digest is the primary key, so the retry would fail
   * on a collision rather than on anything the user did.
   */
  async nonce(): Promise<bigint> {
    const [row] = await this.db.select({ n: count() }).from(proposals);
    return BigInt(row?.n ?? 0);
  }

  /** The starting balance less whatever actually executed, so spending it looks like spending. */
  async balance(): Promise<bigint> {
    const [row] = await this.db
      .select({ spent: sql<string>`coalesce(sum(${proposals.callValue}::numeric), 0)::text` })
      .from(proposals)
      .where(eq(proposals.status, "EXECUTED"));

    const spent = BigInt(row?.spent ?? "0");
    return spent >= MOCK_START_BALANCE_WEI ? 0n : MOCK_START_BALANCE_WEI - spent;
  }

  quoteSwap(sellWei: bigint): Promise<bigint> {
    return Promise.resolve(sellWei * MOCK_SWAP_RATE);
  }
}

/* ---- the shop ------------------------------------------------------------- */

export interface MockShopItem {
  id: string;
  itemName: string;
  priceWei: bigint;
  merchant: Address;
  shopUrl: string;
}

export const MOCK_SHOP_ITEMS: MockShopItem[] = [
  {
    id: "hoodie",
    itemName: "Tappy hoodie",
    priceWei: 20_000_000_000_000_000n, // 0.02
    merchant: MOCK_MERCHANT,
    shopUrl: "/shop/hoodie",
  },
  {
    id: "stickers",
    itemName: "Sticker pack",
    priceWei: 1_000_000_000_000_000n, // 0.001
    merchant: MOCK_MERCHANT,
    shopUrl: "/shop/stickers",
  },
  {
    id: "coffee",
    itemName: "Bag of coffee",
    priceWei: 5_000_000_000_000_000n, // 0.005
    merchant: MOCK_MERCHANT,
    shopUrl: "/shop/coffee",
  },
];

export class MockShopReader implements ShopReader {
  item(itemId: string) {
    const found = MOCK_SHOP_ITEMS.find((i) => i.id === itemId.toLowerCase());
    if (!found) return Promise.resolve(undefined);

    return Promise.resolve({
      // One invoice per request, so buying the same thing twice is two proposals rather than one
      // digest that collides with itself.
      invoiceId: `${found.id}-${Date.now()}`,
      itemName: found.itemName,
      priceWei: found.priceWei,
      merchant: found.merchant,
      shopUrl: found.shopUrl,
    });
  }
}

/* ---- the "model" ---------------------------------------------------------- */

const ADDRESS = /0x[0-9a-fA-F]{40}/;
const AMOUNT = /(\d+(?:\.\d+)?)/;

/** What the keyword matcher decided. Exported so a test can check the routing without the client. */
export interface ScriptedDecision {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Keyword routing, dressed up as a model.
 *
 * Deliberately dumb and deliberately narrow. A cleverer fake would be harder to tell apart from a
 * real model, and being able to tell them apart is the entire point of this file existing.
 */
export function decide(text: string): ScriptedDecision | string {
  const lower = text.toLowerCase();
  const address = ADDRESS.exec(text)?.[0];
  // The address has to come out before the amount goes looking, or it finds the digits inside the
  // address. "send some eth to 0x7099..." reads as an amount of 0, and a proposal to send nothing
  // is one the human would approve without noticing.
  const amount = AMOUNT.exec(address ? text.replace(address, " ") : text)?.[1];

  if (/balance|wallet|how much|what.*have/.test(lower)) {
    return { tool: "get_wallet", args: {} };
  }

  if (/status|pending|proposals?\b/.test(lower) && !/send|buy|swap/.test(lower)) {
    return { tool: "list_proposals", args: { limit: 5 } };
  }

  if (/\bbuy\b|\bpurchase\b|\border\b/.test(lower)) {
    const item = MOCK_SHOP_ITEMS.find((i) => lower.includes(i.id));
    if (!item) {
      return `I can buy any of these: ${MOCK_SHOP_ITEMS.map((i) => i.id).join(", ")}. Which one?`;
    }
    return { tool: "propose_buy", args: { itemId: item.id } };
  }

  if (/\bswap\b|\btrade\b|\bexchange\b/.test(lower)) {
    if (!amount) return "How much do you want to swap?";
    return { tool: "propose_swap", args: { sellEth: amount } };
  }

  if (/\bsend\b|\bpay\b|\btransfer\b/.test(lower)) {
    if (!amount && !address) return "How much, and to which address?";
    if (!amount) return "How much should I send?";
    if (!address) return "What address should it go to?";
    return { tool: "propose_send", args: { to: address, amountEth: amount } };
  }

  return "I can check the wallet, send, swap, or buy something from the shop. Which?";
}

/** Prose for whatever the tool handed back, so the turn ends with something readable. */
function replyFor(tool: string, output: unknown): string {
  const o = (output ?? {}) as Record<string, unknown>;

  if (typeof o.error === "string") return o.error;
  if (typeof o.summary === "string") return o.summary;

  if (tool === "get_wallet") {
    return `The wallet holds ${String(o.balance)} on ${String(o.chain)}. The approval device is ${
      o.signerConnected ? "connected" : "not connected"
    }.`;
  }

  if (tool === "list_proposals") {
    const rows = Array.isArray(output) ? output : [];
    if (rows.length === 0) return "Nothing has been proposed yet.";
    return rows
      .map((r) => {
        const row = r as Record<string, unknown>;
        return `${String(row.summary)} (${String(row.status)})`;
      })
      .join("\n");
  }

  return "Done.";
}

let callId = 0;

/**
 * A `ResponsesClient` that never leaves the process.
 *
 * It reads the same input the real API would and answers in the same shape, so `runAgentTurn` is
 * exercised for real: the tools run, the results come back, the items are stored. Only the choice
 * of which tool to call is fake.
 */
export class ScriptedResponses implements ResponsesClient {
  responses = {
    create: (
      body: OpenAI.Responses.ResponseCreateParamsNonStreaming,
    ): Promise<OpenAI.Responses.Response> => {
      const input = (body.input ?? []) as OpenAI.Responses.ResponseInputItem[];

      // A tool has already run this turn, so this request is the one that writes the reply.
      const lastOutput = [...input].reverse().find(
        (i) => "type" in i && i.type === "function_call_output",
      ) as { call_id?: string; output?: string } | undefined;
      const lastCall = [...input]
        .reverse()
        .find((i) => "type" in i && i.type === "function_call") as
        | { name?: string; call_id?: string }
        | undefined;

      if (lastOutput && lastCall && lastOutput.call_id === lastCall.call_id) {
        let parsed: unknown = {};
        try {
          parsed = JSON.parse(lastOutput.output ?? "{}");
        } catch {
          parsed = { error: lastOutput.output };
        }
        return this.reply(replyFor(lastCall.name ?? "", parsed));
      }

      const lastUser = [...input]
        .reverse()
        .find((i) => "role" in i && i.role === "user") as { content?: unknown } | undefined;
      const text = typeof lastUser?.content === "string" ? lastUser.content : "";

      const decision = decide(text);
      if (typeof decision === "string") return this.reply(decision);

      return Promise.resolve({
        output: [
          {
            type: "function_call",
            name: decision.tool,
            call_id: `mock_${++callId}`,
            arguments: JSON.stringify(decision.args),
          },
        ],
        output_text: "",
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as OpenAI.Responses.Response);
    },
  };

  private reply(text: string): Promise<OpenAI.Responses.Response> {
    return Promise.resolve({
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
      output_text: text,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as OpenAI.Responses.Response);
  }
}
