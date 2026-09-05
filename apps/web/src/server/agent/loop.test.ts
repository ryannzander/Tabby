import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";

import { MAX_TOOL_ROUND_TRIPS, runAgentTurn, type ResponsesClient } from "./loop";
import { SYSTEM_PROMPT } from "./prompt";
import { TOOL_DEFINITIONS, type AgentTools } from "./tools";

/* ---- fakes ---------------------------------------------------------------- */

function toolCall(name: string, args: unknown, callId = `call_${name}`) {
  return { type: "function_call", name, call_id: callId, arguments: JSON.stringify(args) };
}

function message(text: string) {
  return { type: "message", role: "assistant", content: [{ type: "output_text", text }] };
}

/** A client that replays a scripted list of responses, one per `create` call. */
function scriptedClient(turns: { output: unknown[]; text?: string }[]) {
  const calls: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [];
  let i = 0;
  const client: ResponsesClient = {
    responses: {
      create: vi.fn(async (body) => {
        calls.push(body);
        const turn = turns[i++] ?? { output: [], text: "" };
        return {
          output: turn.output,
          output_text: turn.text ?? "",
          usage: { input_tokens: 10, output_tokens: 5 },
        } as unknown as OpenAI.Responses.Response;
      }),
    },
  };
  return { client, calls };
}

function fakeTools(overrides: Partial<AgentTools> = {}): AgentTools {
  return {
    get_wallet: vi.fn(async () => ({
      gate: "0x1111111111111111111111111111111111111111",
      chain: "Sepolia",
      balance: "0.49 ETH",
      agent: "0x2222222222222222222222222222222222222222",
      human: "0x3333333333333333333333333333333333333333",
      signerConnected: true,
    })),
    propose_send: vi.fn(async () => ({
      proposalId: `0x${"ab".repeat(32)}`,
      status: "PENDING_HUMAN" as const,
      summary: "Send 0.01 ETH. Waiting on the human's device.",
    })),
    propose_swap: vi.fn(async () => {
      throw new Error("not used");
    }),
    propose_buy: vi.fn(async () => {
      throw new Error("not used");
    }),
    get_proposal: vi.fn(async () => ({
      proposalId: `0x${"ab".repeat(32)}`,
      status: "PENDING_HUMAN" as const,
      summary: "Send 0.01 ETH",
    })),
    list_proposals: vi.fn(async () => []),
    ...overrides,
  };
}

const RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

/* ---- tests ---------------------------------------------------------------- */

describe("runAgentTurn", () => {
  it("returns the reply without calling a tool when the model does not ask for one", async () => {
    const { client, calls } = scriptedClient([{ output: [message("What address?")], text: "What address?" }]);
    const tools = fakeTools();

    const turn = await runAgentTurn("Send some money to my friend.", { client, tools });

    expect(turn.text).toBe("What address?");
    expect(turn.toolCalls).toEqual([]);
    expect(turn.roundTrips).toBe(0);
    expect(calls).toHaveLength(1);
    expect(tools.propose_send).not.toHaveBeenCalled();
  });

  it("runs the tool, feeds the result back, and answers", async () => {
    const { client, calls } = scriptedClient([
      { output: [toolCall("propose_send", { to: RECIPIENT, amountEth: "0.01", memo: null })] },
      { output: [message("It is waiting on your Flipper.")], text: "It is waiting on your Flipper." },
    ]);
    const tools = fakeTools();

    const turn = await runAgentTurn(`Send 0.01 ETH to ${RECIPIENT}.`, { client, tools });

    expect(tools.propose_send).toHaveBeenCalledWith({ to: RECIPIENT, amountEth: "0.01", memo: null });
    expect(turn.roundTrips).toBe(1);
    expect(turn.text).toBe("It is waiting on your Flipper.");
    expect(turn.toolCalls[0]?.output).toMatchObject({ status: "PENDING_HUMAN" });

    // The second request has to carry the call and its output, or the model has no idea what happened.
    const second = calls[1]!.input as OpenAI.Responses.ResponseInputItem[];
    expect(second.some((i) => "type" in i && i.type === "function_call")).toBe(true);
    expect(second.some((i) => "type" in i && i.type === "function_call_output")).toBe(true);
  });

  it("sends the system prompt and the tool definitions on every request", async () => {
    const { client, calls } = scriptedClient([{ output: [message("hi")], text: "hi" }]);
    await runAgentTurn("hi", { client, tools: fakeTools() });

    expect(calls[0]!.instructions).toBe(SYSTEM_PROMPT);
    expect(calls[0]!.tools).toEqual(TOOL_DEFINITIONS);
    expect(calls[0]!.reasoning).toEqual({ effort: "low" });
  });

  // A handler throwing is the "no approval device connected" path. The user has to be told, so
  // the error goes back to the model rather than ending the turn in silence.
  it("hands a failing tool back to the model as a result, not an exception", async () => {
    const { client } = scriptedClient([
      { output: [toolCall("propose_send", { to: RECIPIENT, amountEth: "0.01", memo: null })] },
      { output: [message("No device is connected.")], text: "No device is connected." },
    ]);
    const tools = fakeTools({
      propose_send: vi.fn(async () => {
        throw new Error("No approval device connected.");
      }),
    });

    const turn = await runAgentTurn("Send 0.01", { client, tools });

    expect(turn.text).toBe("No device is connected.");
    expect(turn.toolCalls[0]?.error).toBe("No approval device connected.");
    expect(turn.toolCalls[0]?.output).toEqual({ error: "No approval device connected." });
  });

  it("rejects arguments that do not match the schema instead of passing them through", async () => {
    const { client } = scriptedClient([
      { output: [toolCall("propose_send", { to: "not-an-address", amountEth: "0.01", memo: null })] },
      { output: [message("That address is not valid.")], text: "That address is not valid." },
    ]);
    const tools = fakeTools();

    const turn = await runAgentTurn("Send 0.01 to not-an-address", { client, tools });

    expect(tools.propose_send).not.toHaveBeenCalled();
    expect(turn.toolCalls[0]?.error).toMatch(/to:/);
  });

  // Known gap, pinned rather than papered over: a wei integer is a valid decimal string, so the
  // schema cannot tell "10000000000000000 wei" from "ten million ETH". Only the tool description
  // stands between the model and an amount eighteen orders of magnitude off. If spike 2 shows the
  // model doing this, the fix is an upper bound checked against the balance, not a regex.
  it("cannot catch an amount given in wei, which the schema reads as a large decimal", async () => {
    const { client } = scriptedClient([
      { output: [toolCall("propose_send", { to: RECIPIENT, amountEth: "10000000000000000", memo: null })] },
      { output: [message("ok")], text: "ok" },
    ]);
    const tools = fakeTools();
    const turn = await runAgentTurn("send", { client, tools });

    expect(tools.propose_send).toHaveBeenCalled();
    expect(turn.toolCalls[0]?.error).toBeUndefined();
  });

  it("refuses an amount sent as a number", async () => {
    const { client } = scriptedClient([
      { output: [toolCall("propose_send", { to: RECIPIENT, amountEth: 0.01, memo: null })] },
      { output: [message("ok")], text: "ok" },
    ]);
    const tools = fakeTools();
    const turn = await runAgentTurn("send", { client, tools });

    expect(tools.propose_send).not.toHaveBeenCalled();
    expect(turn.toolCalls[0]?.error).toMatch(/amountEth/);
  });

  it("survives arguments that are not valid JSON", async () => {
    const { client } = scriptedClient([
      { output: [{ type: "function_call", name: "propose_send", call_id: "c1", arguments: "{oops" }] },
      { output: [message("Something went wrong.")], text: "Something went wrong." },
    ]);
    const turn = await runAgentTurn("send", { client, tools: fakeTools() });

    expect(turn.toolCalls[0]?.error).toMatch(/not valid JSON/);
    expect(turn.text).toBe("Something went wrong.");
  });

  it("refuses a tool it does not have", async () => {
    const { client } = scriptedClient([
      { output: [toolCall("drain_wallet", {})] },
      { output: [message("I cannot do that.")], text: "I cannot do that." },
    ]);
    const turn = await runAgentTurn("drain it", { client, tools: fakeTools() });

    expect(turn.toolCalls[0]?.error).toBe("Unknown tool drain_wallet");
  });

  it("runs several tool calls from one response", async () => {
    const { client } = scriptedClient([
      { output: [toolCall("get_wallet", {}, "c1"), toolCall("list_proposals", { limit: null }, "c2")] },
      { output: [message("Here you go.")], text: "Here you go." },
    ]);
    const tools = fakeTools();
    const turn = await runAgentTurn("what's in the wallet", { client, tools });

    expect(turn.toolCalls.map((c) => c.name)).toEqual(["get_wallet", "list_proposals"]);
    expect(turn.roundTrips).toBe(1);
    expect(tools.get_wallet).toHaveBeenCalled();
  });

  // A model that keeps calling tools keeps spending. The cap has to hold even against a model
  // that never stops asking.
  it("stops at the round-trip cap and still answers", async () => {
    const forever = Array.from({ length: 20 }, () => ({
      output: [toolCall("get_wallet", {})],
    }));
    const { client, calls } = scriptedClient([...forever, { output: [message("done")], text: "done" }]);
    const tools = fakeTools();

    const turn = await runAgentTurn("loop forever", { client, tools });

    expect(turn.hitCap).toBe(true);
    expect(turn.roundTrips).toBe(MAX_TOOL_ROUND_TRIPS);
    expect(tools.get_wallet).toHaveBeenCalledTimes(MAX_TOOL_ROUND_TRIPS);
    // Every function_call still got an output, or the next request would be malformed.
    const last = calls.at(-1)!.input as OpenAI.Responses.ResponseInputItem[];
    const made = last.filter((i) => "type" in i && i.type === "function_call").length;
    const answered = last.filter((i) => "type" in i && i.type === "function_call_output").length;
    expect(answered).toBe(made);
  });

  // The cap has to bound the API calls, not just the tools that run. The test above lets the
  // scripted model give up on its own, which hides the case that costs money: a model that
  // answers "stop calling tools" with another tool call. Nothing here ever stops asking.
  it("stops requesting once the budget is spent, even if the model never stops asking", async () => {
    const calls: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [];
    const client: ResponsesClient = {
      responses: {
        create: vi.fn(async (body) => {
          calls.push(body);
          return {
            output: [toolCall("get_wallet", {}, `call_${calls.length}`)],
            output_text: "",
            usage: { input_tokens: 10, output_tokens: 5 },
          } as unknown as OpenAI.Responses.Response;
        }),
      },
    };
    const tools = fakeTools();

    const turn = await runAgentTurn("never stop", { client, tools });

    expect(turn.hitCap).toBe(true);
    expect(tools.get_wallet).toHaveBeenCalledTimes(MAX_TOOL_ROUND_TRIPS);
    // Six round trips, the request that hits the cap, then one final request with tools forbidden.
    expect(calls).toHaveLength(MAX_TOOL_ROUND_TRIPS + 2);
    expect(calls.at(-1)!.tool_choice).toBe("none");

    // The final response's tool call cannot be answered, so it must not reach the history the
    // caller keeps. Every function_call that does survive has an output next to it.
    const made = turn.items.filter((i) => "type" in i && i.type === "function_call").length;
    const answered = turn.items.filter((i) => "type" in i && i.type === "function_call_output").length;
    expect(made).toBe(MAX_TOOL_ROUND_TRIPS + 1);
    expect(answered).toBe(made);
  });

  it("carries prior history into the first request", async () => {
    const { client, calls } = scriptedClient([{ output: [message("ok")], text: "ok" }]);
    const history = [{ role: "user" as const, content: "earlier" }];

    await runAgentTurn("now", { client, tools: fakeTools(), history });

    expect(calls[0]!.input).toEqual([{ role: "user", content: "earlier" }, { role: "user", content: "now" }]);
  });

  it("returns items the caller can append to history", async () => {
    const { client } = scriptedClient([
      { output: [toolCall("get_wallet", {})] },
      { output: [message("ok")], text: "ok" },
    ]);
    const turn = await runAgentTurn("hi", { client, tools: fakeTools() });

    expect(turn.items[0]).toEqual({ role: "user", content: "hi" });
    expect(turn.items.filter((i) => "type" in i && i.type === "function_call_output")).toHaveLength(1);
  });
});
