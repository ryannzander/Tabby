/**
 * Proposal persistence, and the state machine that guards it.
 *
 * Two rules live here rather than in the callers, because there are four callers and they must
 * not each get it right independently:
 *
 * 1. Every status change goes through `transition`, which refuses a move `ALLOWED_TRANSITIONS`
 *    does not list. An illegal transition is a bug, not a log line, so it throws.
 * 2. At most one proposal is `PENDING_HUMAN`. A second would reuse the nonce and the first
 *    execution to land would invalidate the other, which on stage looks like a random revert.
 *    A partial unique index in the schema backs this up so a race cannot slip past.
 *
 * `db` is passed in rather than imported so these work from a tRPC procedure (`ctx.db`), the
 * relayer tick and a verify script alike.
 */

import { and, desc, eq } from "drizzle-orm";
import type { Hex } from "viem";
import type { z } from "zod";

import {
  ALLOWED_TRANSITIONS,
  actionSchema,
  type Action,
  type Proposal,
  type ProposalStatus,
  type ProposalView,
} from "@tappy/protocol";

import type { db as Database } from "~/server/db";
import { proposals } from "~/server/db/schema";

type Db = typeof Database;
type Row = typeof proposals.$inferSelect;

/** Thrown when something tried to move a proposal somewhere the state machine forbids. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly id: string,
    readonly from: ProposalStatus,
    readonly to: ProposalStatus,
  ) {
    super(`Illegal transition ${from} -> ${to} for ${id}`);
    this.name = "IllegalTransitionError";
  }
}

/** Thrown when a proposal is asked to move but is no longer in the status the caller expected. */
export class StaleTransitionError extends Error {
  constructor(
    readonly id: string,
    readonly expected: ProposalStatus,
    readonly actual: ProposalStatus | undefined,
  ) {
    super(
      actual === undefined
        ? `No proposal ${id}`
        : `Proposal ${id} is ${actual}, not ${expected}; something else moved it first`,
    );
    this.name = "StaleTransitionError";
  }
}

export class PendingProposalError extends Error {
  constructor(readonly pending: Proposal) {
    super(
      `Proposal ${pending.id} is still waiting on the human. Approve or reject it before proposing again.`,
    );
    this.name = "PendingProposalError";
  }
}

/** Pure, so the routers can check a move before touching the database. */
export function isLegalTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertLegalTransition(id: string, from: ProposalStatus, to: ProposalStatus): void {
  if (!isLegalTransition(from, to)) throw new IllegalTransitionError(id, from, to);
}

/**
 * Bigints are text columns: postgres-js hands back `bigint` as a JS number and wei does not
 * survive that. `actionSchema.parse` is what turns the stored string amounts back into bigints.
 */
export function rowToProposal(row: Row): Proposal {
  return {
    id: row.id as Hex,
    chainId: row.chainId,
    gate: row.gate as Proposal["gate"],
    nonce: BigInt(row.nonce),
    call: { to: row.callTo as Proposal["call"]["to"], value: BigInt(row.callValue), data: row.callData as Hex },
    action: actionSchema.parse(row.action),
    deadline: row.deadline,
    agentSig: (row.agentSig ?? undefined) as Hex | undefined,
    humanSig: (row.humanSig ?? undefined) as Hex | undefined,
    status: row.status,
    txHash: (row.txHash ?? undefined) as Hex | undefined,
    error: row.error ?? undefined,
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
    decidedAt: row.decidedAt ? Math.floor(row.decidedAt.getTime() / 1000) : undefined,
    originator: row.originator,
  };
}

/**
 * `actionSchema.parse` goes the other way: its input takes strings and its output is bigints. The
 * jsonb column stores the *input* shape, so the amounts have to be stringified by hand here.
 * Parsing on the way in looks right, compiles, and then throws "Do not know how to serialize a
 * BigInt" the first time a real proposal is written.
 */
function actionToStored(a: Action): z.input<typeof actionSchema> {
  switch (a.kind) {
    case "send":
      return { ...a, valueWei: a.valueWei.toString() };
    case "swap":
      return { ...a, sellWei: a.sellWei.toString(), minBuy: a.minBuy.toString() };
    case "buy":
      return { ...a, valueWei: a.valueWei.toString() };
  }
}

export function proposalToRow(p: Proposal, view: ProposalView): typeof proposals.$inferInsert {
  return {
    id: p.id,
    chainId: p.chainId,
    gate: p.gate,
    nonce: p.nonce.toString(),
    callTo: p.call.to,
    callValue: p.call.value.toString(),
    callData: p.call.data,
    action: actionToStored(p.action),
    view,
    deadline: p.deadline,
    agentSig: p.agentSig ?? null,
    humanSig: p.humanSig ?? null,
    status: p.status,
    createdAt: new Date(p.createdAt * 1000),
    originator: p.originator,
  };
}

export async function getProposal(db: Db, id: string): Promise<Proposal | undefined> {
  const row = await db.query.proposals.findFirst({ where: eq(proposals.id, id) });
  return row ? rowToProposal(row) : undefined;
}

export async function listProposals(db: Db, limit = 20): Promise<Proposal[]> {
  const rows = await db
    .select()
    .from(proposals)
    .orderBy(desc(proposals.createdAt))
    .limit(limit);
  return rows.map(rowToProposal);
}

export async function pendingProposal(db: Db): Promise<Proposal | undefined> {
  const row = await db.query.proposals.findFirst({
    where: eq(proposals.status, "PENDING_HUMAN"),
  });
  return row ? rowToProposal(row) : undefined;
}

/**
 * A proposal and the exact view the device was given for it.
 *
 * The screen shows the stored `view` rather than deriving its own from the action. The device and
 * the human have to be reading the same words: a screen that renders "0.01 to Alice" while the
 * Flipper renders something else is the one failure this design exists to prevent.
 */
export interface ProposalWithView {
  proposal: Proposal;
  view: ProposalView;
}

export async function pendingProposalWithView(db: Db): Promise<ProposalWithView | undefined> {
  const row = await db.query.proposals.findFirst({
    where: eq(proposals.status, "PENDING_HUMAN"),
  });
  return row ? { proposal: rowToProposal(row), view: row.view } : undefined;
}

export async function listProposalsWithView(db: Db, limit = 20): Promise<ProposalWithView[]> {
  const rows = await db
    .select()
    .from(proposals)
    .orderBy(desc(proposals.createdAt))
    .limit(limit);
  return rows.map((row) => ({ proposal: rowToProposal(row), view: row.view }));
}

/**
 * Writes a new `PENDING_HUMAN` proposal.
 *
 * Refuses while another is pending and hands back the pending one, because the caller's next move
 * is to show the human what they are already being asked to approve. Silently queueing the second
 * would let the nonce collide.
 */
export async function insertProposal(db: Db, p: Proposal, view: ProposalView): Promise<Proposal> {
  const pending = await pendingProposal(db);
  if (pending) throw new PendingProposalError(pending);

  const [row] = await db.insert(proposals).values(proposalToRow(p, view)).returning();
  if (!row) throw new Error(`Insert of proposal ${p.id} returned no row`);
  return rowToProposal(row);
}

export interface TransitionPatch {
  humanSig?: Hex;
  txHash?: Hex;
  error?: string;
  decidedAt?: Date;
}

/**
 * The only way a status changes.
 *
 * `from` is required and matched in the WHERE clause, so this is a compare-and-set: two workers
 * racing to move the same proposal cannot both win. The loser gets a `StaleTransitionError` and
 * stops, rather than overwriting a decision that already happened.
 */
export async function transition(
  db: Db,
  id: string,
  from: ProposalStatus,
  to: ProposalStatus,
  patch: TransitionPatch = {},
): Promise<Proposal> {
  assertLegalTransition(id, from, to);

  const [row] = await db
    .update(proposals)
    .set({
      status: to,
      ...(patch.humanSig !== undefined ? { humanSig: patch.humanSig } : {}),
      ...(patch.txHash !== undefined ? { txHash: patch.txHash } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      decidedAt: patch.decidedAt ?? new Date(),
    })
    .where(and(eq(proposals.id, id), eq(proposals.status, from)))
    .returning();

  if (!row) {
    const actual = await db.query.proposals.findFirst({ where: eq(proposals.id, id) });
    throw new StaleTransitionError(id, from, actual?.status);
  }
  return rowToProposal(row);
}
