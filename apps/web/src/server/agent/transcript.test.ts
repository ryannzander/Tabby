import { describe, expect, it } from "vitest";
import type OpenAI from "openai";

import type { ToolInvocation } from "./loop";
import {
  historyFromRows,
  rowToChatMessage,
  userItem,
  type HistoryRow,
  type TranscriptRow,
} from "./transcript";

function items(...texts: string[]): OpenAI.Responses.ResponseInputItem[] {
  return texts.map((t) => ({ role: "user", content: t }));
}

describe("historyFromRows", () => {
  it("concatenates items oldest first", () => {
    const rows: HistoryRow[] = [
      { seq: 1, items: items("one") },
      { seq: 2, items: items("two", "three") },
    ];

    expect(historyFromRows(rows)).toEqual(items("one", "two", "three"));
  });

  // A query that forgets its orderBy hands back a plausible conversation in the wrong sequence,
  // and the symptom is a model that looks confused rather than an error.
  it("sorts by seq rather than trusting the order it is given", () => {
    const rows: HistoryRow[] = [
      { seq: 3, items: items("three") },
      { seq: 1, items: items("one") },
      { seq: 2, items: items("two") },
    ];

    expect(historyFromRows(rows)).toEqual(items("one", "two", "three"));
  });

  it("skips rows with no items", () => {
    const rows: HistoryRow[] = [
      { seq: 1, items: items("one") },
      { seq: 2, items: null },
    ];

    expect(historyFromRows(rows)).toEqual(items("one"));
  });

  it("does not mutate the rows it is given", () => {
    const rows: HistoryRow[] = [
      { seq: 2, items: items("two") },
      { seq: 1, items: items("one") },
    ];

    historyFromRows(rows);

    expect(rows.map((r) => r.seq)).toEqual([2, 1]);
  });

  it("is empty for an empty transcript", () => {
    expect(historyFromRows([])).toEqual([]);
  });
});

describe("rowToChatMessage", () => {
  const toolCall: ToolInvocation = {
    name: "get_wallet",
    input: {},
    output: { balance: "0.49 ETH" },
  };

  const row: TranscriptRow = {
    seq: 7,
    role: "assistant",
    text: "You have 0.49 ETH.",
    toolCalls: [toolCall],
    createdAt: new Date("2026-09-05T12:00:30.750Z"),
  };

  it("carries the tool calls through for the UI", () => {
    expect(rowToChatMessage(row).toolCalls).toEqual([toolCall]);
  });

  // Everything else in the app times in unix seconds, including Proposal.createdAt.
  it("converts the timestamp to unix seconds", () => {
    expect(rowToChatMessage(row).createdAt).toBe(
      Math.floor(new Date("2026-09-05T12:00:30.750Z").getTime() / 1000),
    );
  });

  it("turns a null toolCalls column into an empty list", () => {
    expect(rowToChatMessage({ ...row, role: "user", toolCalls: null }).toolCalls).toEqual([]);
  });
});

describe("userItem", () => {
  // sendChatTurn writes this row before the turn and then drops the loop's own copy. The two have
  // to be the same shape or the model reads the message twice on every later turn.
  it("matches the item runAgentTurn puts first", () => {
    expect(userItem("send 0.01 to alice")).toEqual({
      role: "user",
      content: "send 0.01 to alice",
    });
  });
});
