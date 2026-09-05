/**
 * Turning stored rows into the two things a chat turn needs: what the model gets sent, and what
 * the human gets shown.
 *
 * These are separate views of the same rows and they must never disagree. The model's history is
 * the concatenated `items`, reasoning and tool calls included, because the Responses API needs its
 * own output handed back or the next request loses the context for the call it just made. The
 * human's view is `text` plus a summary of the tools. A row carries both, so neither can be
 * written without the other.
 *
 * Pure on purpose: the router does the reading and writing, and everything decided here is
 * testable without a database.
 */

import type OpenAI from "openai";

import type { ToolInvocation } from "./loop";

/** The columns the model's history is rebuilt from. */
export interface HistoryRow {
  seq: number;
  items: OpenAI.Responses.ResponseInputItem[] | null;
}

/** The columns the UI renders. */
export interface TranscriptRow {
  seq: number;
  role: "user" | "assistant";
  text: string;
  toolCalls: ToolInvocation[] | null;
  createdAt: Date;
}

export interface ChatMessage {
  seq: number;
  role: "user" | "assistant";
  text: string;
  toolCalls: ToolInvocation[];
  /** Unix seconds, matching `Proposal.createdAt`, so the UI has one time format to deal with. */
  createdAt: number;
}

/**
 * The model's history, oldest first.
 *
 * Sorted here rather than trusted from the caller. Order is the whole meaning of a conversation
 * and a query that forgot its `orderBy` would produce a plausible-looking history in the wrong
 * sequence, which reads as the model being confused rather than as a bug.
 */
export function historyFromRows(rows: HistoryRow[]): OpenAI.Responses.ResponseInputItem[] {
  return [...rows]
    .sort((a, b) => a.seq - b.seq)
    .flatMap((row) => row.items ?? []);
}

export function rowToChatMessage(row: TranscriptRow): ChatMessage {
  return {
    seq: row.seq,
    role: row.role,
    text: row.text,
    toolCalls: row.toolCalls ?? [],
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
  };
}

/**
 * The user's message as the model sees it.
 *
 * Built here so the row written before the turn and the item `runAgentTurn` prepends are the same
 * shape. If they drift, the model reads the message twice.
 */
export function userItem(text: string): OpenAI.Responses.ResponseInputItem {
  return { role: "user", content: text };
}
