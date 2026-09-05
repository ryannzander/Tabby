/**
 * Assembling the pieces a chat turn runs on: the model client and the tools.
 *
 * Everything here fails by name. "OPENAI_API_KEY is not set" is a thirty-second fix; a loop that
 * quietly runs with no tools is a model that will report sending money it never sent, and on stage
 * there is no way back from that.
 *
 * The tools are not wired yet, and this is where that stops being invisible. `createAgentTools`
 * needs a `ChainReader` and a gate address, and nothing is deployed (issue #5). Rather than fake
 * either one, `agentToolsFromEnv` refuses and says exactly what is missing.
 */

import OpenAI from "openai";

import { env } from "~/env";

import type { ResponsesClient } from "./loop";
import type { AgentTools } from "./tools";

export function openaiFromEnv(): ResponsesClient {
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set, so the agent cannot run. Add it to apps/web/.env.",
    );
  }
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

/**
 * Not implemented, on purpose.
 *
 * Two things are missing and neither can be guessed: a deployed `TappyGate` to read the nonce and
 * the balance from, and the mock DEX and merchant addresses the swap and buy actions target. A
 * placeholder address would produce a proposal whose digest the human approves and the chain then
 * rejects, which surfaces as "bad signature" and tells you nothing.
 */
export function agentToolsFromEnv(): AgentTools {
  throw new Error(
    "The agent tools are not wired up yet: `ChainReader` and `ShopReader` have no implementation " +
      "because nothing is deployed (issue #5). Everything else in chat.send works.",
  );
}
