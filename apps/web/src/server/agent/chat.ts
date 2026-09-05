/**
 * A chat turn, from stored history to stored reply. SPEC §2 step 1.
 *
 * `db` and the model client are passed in rather than imported, so the tRPC procedure, a verify
 * script and a test can all drive the same code. This is the only place chat messages are written.
 *
 * The order of operations matters and is not the obvious one. The user's row is written *before*
 * the turn runs, not with the reply afterwards. A turn can fail halfway, after the model has
 * already written a proposal, and if the user's message were only stored on success the human
 * would be looking at a proposal that no message in the transcript asked for. Storing it first
 * costs a dangling row on failure, which is what a failed turn actually looks like.
 */

import { asc, desc } from "drizzle-orm";

import type { db as Database } from "~/server/db";
import { messages } from "~/server/db/schema";

import { runAgentTurn, type ResponsesClient, type ToolInvocation } from "./loop";
import type { AgentTools } from "./tools";
import { historyFromRows, rowToChatMessage, userItem, type ChatMessage } from "./transcript";

type Db = typeof Database;

/**
 * How many rows of history the model is sent. Every turn pays for all of them, and the demo is one
 * conversation about one wallet, so this is generous. Sliced by row rather than by item on
 * purpose: a row holds a whole turn, so a `function_call` can never be separated from the output
 * that answers it, which would make the next request malformed.
 */
export const MAX_HISTORY_ROWS = 40;

export interface ChatDeps {
  client: ResponsesClient;
  tools: AgentTools;
}

export interface ChatTurnResult {
  user: ChatMessage;
  assistant: ChatMessage;
  /** True when the model was still calling tools when the round-trip budget ran out. */
  hitCap: boolean;
  inputTokens: number;
  outputTokens: number;
}

/** The whole transcript, oldest first. */
export async function chatHistory(db: Db): Promise<ChatMessage[]> {
  const rows = await db
    .select({
      seq: messages.seq,
      role: messages.role,
      text: messages.text,
      toolCalls: messages.toolCalls,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .orderBy(asc(messages.seq));

  return rows.map(rowToChatMessage);
}

export async function sendChatTurn(
  db: Db,
  text: string,
  deps: ChatDeps,
): Promise<ChatTurnResult> {
  // Newest first with a limit, then `historyFromRows` puts them back in order. Asking for the
  // oldest N would send the model the beginning of the conversation and drop what just happened.
  const priorRows = await db
    .select({ seq: messages.seq, items: messages.items })
    .from(messages)
    .orderBy(desc(messages.seq))
    .limit(MAX_HISTORY_ROWS);
  const history = historyFromRows(priorRows);

  const [userRow] = await db
    .insert(messages)
    .values({ role: "user", text, items: [userItem(text)] })
    .returning();
  if (!userRow) throw new Error("Insert of the user message returned no row");

  const turn = await runAgentTurn(text, { client: deps.client, tools: deps.tools, history });

  // `runAgentTurn` prepends the user message to the items it returns, and the row above already
  // holds it. Asserted rather than assumed: a silent duplicate would show the model the same
  // message twice on every later turn, and it would look like the model repeating itself.
  const [first, ...rest] = turn.items;
  if (!first || !("role" in first) || first.role !== "user") {
    throw new Error(
      "runAgentTurn no longer returns the user message as its first item; the stored history would duplicate it.",
    );
  }

  const [assistantRow] = await db
    .insert(messages)
    .values({
      role: "assistant",
      text: turn.text,
      items: rest,
      toolCalls: turn.toolCalls satisfies ToolInvocation[],
    })
    .returning();
  if (!assistantRow) throw new Error("Insert of the assistant message returned no row");

  return {
    user: rowToChatMessage(userRow),
    assistant: rowToChatMessage(assistantRow),
    hitCap: turn.hitCap,
    inputTokens: turn.inputTokens,
    outputTokens: turn.outputTokens,
  };
}
