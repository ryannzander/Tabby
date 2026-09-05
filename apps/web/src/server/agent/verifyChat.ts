/**
 * The chat turn against a real Postgres, with a scripted model.
 *
 * The unit tests cover the pure half, and the model is faked here because none of what this
 * checks is about the model: it is about whether a conversation survives a round trip through
 * jsonb. Whether reasoning items and tool calls come back the same shape they went in, whether
 * the user message is stored once rather than twice, and whether a turn that throws leaves the
 * transcript in a state the next turn can read.
 *
 * Run:  pnpm --filter @tappy/web verify:chat
 *
 * Needs DATABASE_URL. It appends rows and deletes exactly the ones it appended, so an existing
 * conversation in the database survives.
 */

import { gt, sql } from "drizzle-orm";
import type OpenAI from "openai";

import { db } from "~/server/db";
import { messages } from "~/server/db/schema";

import { chatHistory, sendChatTurn } from "./chat";
import type { ResponsesClient } from "./loop";
import type { AgentTools } from "./tools";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

/* ---- the scripted model --------------------------------------------------- */

function message(text: string) {
  return { type: "message", role: "assistant", content: [{ type: "output_text", text }] };
}

function toolCall(name: string, args: unknown, callId: string) {
  return { type: "function_call", name, call_id: callId, arguments: JSON.stringify(args) };
}

/** Reasoning items have to come back too, or the next request drops the model's own context. */
function reasoning(id: string) {
  return { type: "reasoning", id, summary: [] };
}

function scriptedClient(turns: { output: unknown[]; text?: string }[]) {
  const seen: OpenAI.Responses.ResponseInputItem[][] = [];
  let i = 0;
  const client: ResponsesClient = {
    responses: {
      create: async (body) => {
        seen.push(body.input as OpenAI.Responses.ResponseInputItem[]);
        const turn = turns[i++] ?? { output: [], text: "" };
        return {
          output: turn.output,
          output_text: turn.text ?? "",
          usage: { input_tokens: 11, output_tokens: 7 },
        } as unknown as OpenAI.Responses.Response;
      },
    },
  };
  return { client, seen };
}

const tools: AgentTools = {
  get_wallet: async () => ({
    gate: "0x1111111111111111111111111111111111111111",
    chain: "Sepolia",
    balance: "0.49 ETH",
    agent: "0x2222222222222222222222222222222222222222",
    human: "0x3333333333333333333333333333333333333333",
    signerConnected: true,
  }),
  propose_send: async () => {
    throw new Error("not used");
  },
  propose_swap: async () => {
    throw new Error("not used");
  },
  propose_buy: async () => {
    throw new Error("not used");
  },
  get_proposal: async () => {
    throw new Error("not used");
  },
  list_proposals: async () => [],
};

/* ---- the run -------------------------------------------------------------- */

async function main() {
  const [{ max } = { max: 0 }] = await db
    .select({ max: sql<number>`coalesce(max(${messages.seq}), 0)` })
    .from(messages);
  const before = Number(max);
  console.log(`\nappending after seq ${before}\n`);

  try {
    console.log("a turn with one tool call");
    const first = scriptedClient([
      { output: [reasoning("rs_1"), toolCall("get_wallet", {}, "call_1")] },
      { output: [message("You have 0.49 ETH.")], text: "You have 0.49 ETH." },
    ]);
    const turn = await sendChatTurn(db, "what's in the wallet?", {
      client: first.client,
      tools,
    });

    check("the user message is stored", turn.user.text === "what's in the wallet?");
    check("the reply is stored", turn.assistant.text === "You have 0.49 ETH.");
    check("the assistant row is after the user row", turn.assistant.seq > turn.user.seq);
    check(
      "the tool call survived jsonb",
      turn.assistant.toolCalls.length === 1 && turn.assistant.toolCalls[0]?.name === "get_wallet",
      JSON.stringify(turn.assistant.toolCalls[0]?.output),
    );
    check("the first request carried no history", first.seen[0]?.length === 1);

    console.log("\nthe next turn sends the first one back");
    const second = scriptedClient([{ output: [message("Still 0.49.")], text: "Still 0.49." }]);
    await sendChatTurn(db, "and now?", { client: second.client, tools });

    const sent = second.seen[0] ?? [];
    const users = sent.filter((i) => "role" in i && i.role === "user");
    check("both user messages reached the model", users.length === 2, `${users.length}`);
    // The row written before the turn and the loop's own copy are the same message. Storing both
    // would show the model everything the human said twice, on every turn from here on.
    check(
      "the first message is not duplicated",
      users.filter((i) => "content" in i && i.content === "what's in the wallet?").length === 1,
    );
    check(
      "the reasoning item came back",
      sent.some((i) => "type" in i && i.type === "reasoning"),
    );
    const calls = sent.filter((i) => "type" in i && i.type === "function_call").length;
    const answered = sent.filter((i) => "type" in i && i.type === "function_call_output").length;
    check("every function_call still has its output", calls === answered && calls === 1, `${calls}`);

    console.log("\na turn that throws leaves a readable transcript");
    const broken: ResponsesClient = {
      responses: {
        create: () => Promise.reject(new Error("the model is down")),
      },
    };
    let threw = false;
    try {
      await sendChatTurn(db, "this one fails", { client: broken, tools });
    } catch (error) {
      threw = true;
      check("the failure reaches the caller", (error as Error).message === "the model is down");
    }
    check("it did not fail silently", threw);

    const third = scriptedClient([{ output: [message("Sorry about that.")], text: "Sorry about that." }]);
    await sendChatTurn(db, "try again", { client: third.client, tools });
    check(
      "the failed turn's message is still in the model's history",
      (third.seen[0] ?? []).some((i) => "content" in i && i.content === "this one fails"),
    );

    console.log("\nthe transcript reads back in order");
    const history = await chatHistory(db);
    const mine = history.filter((m) => m.seq > before);
    check("every row came back", mine.length === 7, `${mine.length}`);
    check(
      "oldest first",
      mine.every((m, i) => i === 0 || m.seq > mine[i - 1]!.seq),
    );
    check(
      "timestamps are unix seconds",
      mine.every((m) => m.createdAt > 1_700_000_000 && m.createdAt < 4_000_000_000),
      `${mine[0]?.createdAt}`,
    );
  } finally {
    await db.delete(messages).where(gt(messages.seq, before));
  }

  console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
