// Example model schema from the Drizzle docs
// https://orm.drizzle.team/docs/sql-schema-declaration

import { sql } from "drizzle-orm";
import { index, pgTableCreator, uniqueIndex } from "drizzle-orm/pg-core";

import type OpenAI from "openai";
import type { z } from "zod";

import { actionSchema } from "@tappy/protocol";
import type { ProposalStatus, ProposalView, SignerKind } from "@tappy/protocol";

import type { ToolInvocation } from "~/server/agent/loop";

/**
 * `Action` holds `bigint` amounts and `JSON.stringify` throws on those, so the column stores the
 * zod *input* shape, where amounts are strings. Read it back with `actionSchema.parse(row.action)`
 * and the bigints come back. Typing the column as `Action` compiles fine and fails at runtime,
 * which is the worst of both.
 */
type StoredAction = z.input<typeof actionSchema>;

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `web_${name}`);

export const posts = createTable(
  "post",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar({ length: 256 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("name_idx").on(t.name)]
);

/**
 * The approval channel (spike 3). Vercel route handlers cannot hold a socket open, so this table
 * *is* the channel: the hub writes a row, the bridge polls for it, the bridge posts a decision
 * back. Nothing streams. See `docs/spikes.md` entry 3.
 *
 * Bigints are stored as text. Postgres `bigint` comes back as a JS number through postgres-js and
 * wei does not survive that. Convert at the edge with `BigInt(row.callValue)`.
 */
export const proposals = createTable(
  "proposal",
  (d) => ({
    /** The EIP-712 digest. The id is the hash, so it is bound to one exact call. */
    id: d.varchar({ length: 66 }).primaryKey(),
    chainId: d.integer().notNull(),
    gate: d.varchar({ length: 42 }).notNull(),
    nonce: d.text().notNull(),

    callTo: d.varchar({ length: 42 }).notNull(),
    callValue: d.text().notNull(),
    callData: d.text().notNull(),

    action: d.jsonb().$type<StoredAction>().notNull(),
    /** Exactly what the Flipper renders. Built once by the hub so the device never derives it. */
    view: d.jsonb().$type<ProposalView>().notNull(),

    deadline: d.integer().notNull(),
    agentSig: d.text(),
    humanSig: d.text(),

    status: d.varchar({ length: 16 }).$type<ProposalStatus>().notNull(),
    txHash: d.varchar({ length: 66 }),
    error: d.text(),

    /** Set when the bridge hands the request to the device, so a poll is not served twice. */
    claimedAt: d.timestamp({ withTimezone: true }),
    /** Increments per request. The device ignores an inbox whose seq it already answered. */
    seq: d.integer().generatedByDefaultAsIdentity().notNull(),

    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    decidedAt: d.timestamp({ withTimezone: true }),
    originator: d.varchar({ length: 8 }).$type<"chat" | "test">().notNull(),
  }),
  (t) => [
    index("proposal_status_idx").on(t.status),
    // Only one proposal may be PENDING_HUMAN at a time or the nonces collide. Enforced in the
    // store as well, but a partial unique index means a race cannot slip past it.
    uniqueIndex("proposal_one_pending_idx")
      .on(t.status)
      .where(sql`${t.status} = 'PENDING_HUMAN'`),
  ]
);

/**
 * Who is currently able to approve. A row is the answer to `signerConnected`, which the wallet
 * panel shows and `propose_*` refuses without. Polling `approvals.next` is the heartbeat, so a
 * bridge that dies goes stale on its own without needing a disconnect message.
 */
/**
 * The chat transcript, and the model's own history alongside it.
 *
 * Both live in one table on purpose. `text` is what the human reads; `items` is the raw Responses
 * API output the turn produced, reasoning and tool calls included, which the next request has to
 * send back or the model loses the context for the call it just made. One row cannot half-commit,
 * so the transcript and the history cannot drift apart. A model that saw a different conversation
 * from the one on screen is the worst bug this app could have, because every symptom of it looks
 * like the model being stupid.
 *
 * `items` and `toolCalls` are set on assistant rows only. The user's message is already the first
 * item of the turn it started.
 */
export const messages = createTable("message", (d) => ({
  seq: d.integer().primaryKey().generatedByDefaultAsIdentity(),
  role: d.varchar({ length: 16 }).$type<"user" | "assistant">().notNull(),
  text: d.text().notNull(),
  items: d.jsonb().$type<OpenAI.Responses.ResponseInputItem[]>(),
  toolCalls: d.jsonb().$type<ToolInvocation[]>(),
  createdAt: d
    .timestamp({ withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
}));

export const signerSessions = createTable("signer_session", (d) => ({
  address: d.varchar({ length: 42 }).primaryKey(),
  kind: d.varchar({ length: 16 }).$type<SignerKind>().notNull(),
  lastSeenAt: d
    .timestamp({ withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
}));
