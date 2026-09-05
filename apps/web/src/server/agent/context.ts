/**
 * Assembling the pieces a chat turn runs on: the model client and the tools.
 *
 * Everything here fails by name. "OPENAI_API_KEY is not set" is a thirty-second fix; a loop that
 * quietly runs with no tools is a model that will report sending money it never sent, and on stage
 * there is no way back from that.
 *
 * Two modes, chosen by `AGENT_MODE`:
 *
 * - `live` reads the real key and the real deploy. It is the default, and while nothing is
 *   deployed the tools half of it refuses and says why.
 * - `mock` uses the stand-ins in `mock.ts`. Nothing reaches a chain, a device or an API.
 *
 * `live` is the default on purpose. A machine meant to be talking to Sepolia should stop rather
 * than quietly serve made-up numbers, because a made-up balance looks exactly like a real one.
 */

import OpenAI from "openai";

import { env } from "~/env";
import type { db as Database } from "~/server/db";

import { createAgentTools } from "./handlers";
import type { ResponsesClient } from "./loop";
import {
  MOCK_DEX,
  MOCK_GATE,
  MOCK_TOKEN,
  MockChainReader,
  MockShopReader,
  ScriptedResponses,
} from "./mock";
import { LocalAgentSigner } from "~/server/tappy/agentSigner";
import type { AgentTools } from "./tools";

type Db = typeof Database;

/** True when nothing in this process is talking to a chain, a device or a model. */
export const isMockMode = () => env.AGENT_MODE === "mock";

/**
 * Anvil account #0, the same well-known key the frozen digest vector uses. Public on purpose, and
 * only reachable in mock mode, where nothing it signs can be submitted anywhere.
 */
const MOCK_AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

export function modelClientFromEnv(): ResponsesClient {
  if (isMockMode()) return new ScriptedResponses();

  if (!env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set, so the agent cannot run. Add it to apps/web/.env, or set " +
        "AGENT_MODE=mock to run against the scripted stand-in instead.",
    );
  }
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

export function agentToolsFromEnv(db: Db): AgentTools {
  if (isMockMode()) {
    return createAgentTools({
      db,
      signer: new LocalAgentSigner(MOCK_AGENT_KEY),
      chain: new MockChainReader(db),
      shop: new MockShopReader(),
      gate: MOCK_GATE,
      dex: MOCK_DEX,
      tokenOut: MOCK_TOKEN,
      chainKey: "sepolia",
      // The bridge is not running and there may not even be a Flipper. Saying "connected" is the
      // one lie this mode tells, and it is what lets the flow be built before the device works.
      signerConnected: () =>
        Promise.resolve({ connected: true, address: MOCK_GATE }),
    });
  }

  // Deliberately unimplemented. Two things are missing and neither can be guessed: a deployed
  // `TappyGate` to read the nonce and balance from, and the DEX and merchant addresses the swap
  // and buy actions target. A placeholder address would produce a proposal whose digest the human
  // approves and the chain then rejects, which surfaces as "bad signature" and explains nothing.
  throw new Error(
    "The agent tools are not wired up for AGENT_MODE=live yet: `ChainReader` and `ShopReader` " +
      "have no implementation because nothing is deployed (issue #5). Set AGENT_MODE=mock to run " +
      "against the stand-ins.",
  );
}
