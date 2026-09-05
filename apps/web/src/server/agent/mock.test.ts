import { describe, expect, it } from "vitest";

import { runAgentTurn } from "./loop";
import { MOCK_SHOP_ITEMS, ScriptedResponses, decide } from "./mock";
import type { AgentTools } from "./tools";

describe("decide", () => {
  it("routes a wallet question to get_wallet", () => {
    expect(decide("what's my balance?")).toEqual({ tool: "get_wallet", args: {} });
  });

  it("routes a send with an amount and an address", () => {
    const to = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    expect(decide(`send 0.01 eth to ${to}`)).toEqual({
      tool: "propose_send",
      args: { to, amountEth: "0.01" },
    });
  });

  // Half a send instruction must not become a proposal with a guessed field in it. The whole
  // design rests on the human approving exactly what was asked for.
  it("asks for the address rather than inventing one", () => {
    expect(decide("send 0.01 eth")).toBe("What address should it go to?");
  });

  it("asks for the amount rather than inventing one", () => {
    expect(decide("send some eth to 0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe(
      "How much should I send?",
    );
  });

  it("routes a known shop item to propose_buy", () => {
    expect(decide("buy the hoodie")).toEqual({ tool: "propose_buy", args: { itemId: "hoodie" } });
  });

  it("lists what the shop has when the item is not one of them", () => {
    const answer = decide("buy a yacht");
    expect(typeof answer).toBe("string");
    for (const item of MOCK_SHOP_ITEMS) expect(answer).toContain(item.id);
  });

  it("routes a swap with an amount", () => {
    expect(decide("swap 0.05 for tokens")).toEqual({
      tool: "propose_swap",
      args: { sellEth: "0.05" },
    });
  });

  it("offers what it can do when it understands nothing", () => {
    expect(decide("hello there")).toContain("wallet");
  });
});

/* ---- the scripted client through the real loop ---------------------------- */

function tools(overrides: Partial<AgentTools> = {}): AgentTools {
  return {
    get_wallet: () =>
      Promise.resolve({
        gate: "0x1111111111111111111111111111111111111111",
        chain: "Sepolia",
        balance: "0.49 ETH",
        agent: "0x2222222222222222222222222222222222222222",
        human: "0x3333333333333333333333333333333333333333",
        signerConnected: true,
      }),
    propose_send: () =>
      Promise.resolve({
        proposalId: `0x${"ab".repeat(32)}`,
        status: "PENDING_HUMAN" as const,
        summary: "Send 0.01 ETH. Waiting on the human's device.",
      }),
    propose_swap: () => Promise.reject(new Error("not used")),
    propose_buy: () => Promise.reject(new Error("not used")),
    get_proposal: () => Promise.reject(new Error("not used")),
    list_proposals: () => Promise.resolve([]),
    ...overrides,
  };
}

describe("ScriptedResponses through runAgentTurn", () => {
  it("calls the tool and then answers with what it got back", async () => {
    const turn = await runAgentTurn(
      "send 0.01 eth to 0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      { client: new ScriptedResponses(), tools: tools() },
    );

    expect(turn.toolCalls.map((c) => c.name)).toEqual(["propose_send"]);
    expect(turn.text).toBe("Send 0.01 ETH. Waiting on the human's device.");
    expect(turn.roundTrips).toBe(1);
  });

  it("answers a wallet question in prose", async () => {
    const turn = await runAgentTurn("what's my balance?", {
      client: new ScriptedResponses(),
      tools: tools(),
    });

    expect(turn.text).toContain("0.49 ETH");
    expect(turn.text).toContain("connected");
  });

  // A failing tool comes back to the model as a result, and the stand-in has to pass it on rather
  // than swallow it. "No approval device connected" is the user's problem to hear about.
  it("relays a tool failure instead of claiming success", async () => {
    const turn = await runAgentTurn("what's my balance?", {
      client: new ScriptedResponses(),
      tools: tools({
        get_wallet: () => Promise.reject(new Error("No approval device connected.")),
      }),
    });

    expect(turn.text).toBe("No approval device connected.");
  });

  it("answers without a tool when it needs more from the user", async () => {
    const turn = await runAgentTurn("send some money", {
      client: new ScriptedResponses(),
      tools: tools(),
    });

    expect(turn.toolCalls).toEqual([]);
    expect(turn.roundTrips).toBe(0);
    expect(turn.text).toContain("How much");
  });

  it("does not loop: one tool call, one answer, done", async () => {
    const turn = await runAgentTurn("buy the hoodie", {
      client: new ScriptedResponses(),
      tools: tools({
        propose_buy: () =>
          Promise.resolve({
            proposalId: `0x${"cd".repeat(32)}`,
            status: "PENDING_HUMAN" as const,
            summary: "Buy Tappy hoodie for 0.02 ETH. Waiting on the human's device.",
          }),
      }),
    });

    expect(turn.roundTrips).toBe(1);
    expect(turn.hitCap).toBe(false);
    expect(turn.text).toContain("Tappy hoodie");
  });
});
