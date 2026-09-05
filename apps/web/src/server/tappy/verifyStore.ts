/**
 * The proposal store against a real Postgres.
 *
 * The unit tests cover the pure half. This covers the half that only breaks against a real
 * database: whether wei survives a round trip through text columns, whether the compare-and-set in
 * `transition` actually stops a second writer, and whether the one-pending rule holds.
 *
 * Run:  pnpm --filter @tappy/web verify:store
 *
 * Needs DATABASE_URL. Writes and deletes rows with `originator = 'test'`.
 */

import { eq } from "drizzle-orm";

import { LocalAgentSigner } from "./agentSigner";
import { db } from "~/server/db";
import { proposals } from "~/server/db/schema";
import { buildProposal } from "./proposals";
import {
  IllegalTransitionError,
  PendingProposalError,
  StaleTransitionError,
  getProposal,
  insertProposal,
  listProposals,
  pendingProposal,
  transition,
} from "./store";

/** Anvil account #0. The same well-known test key as the frozen vector. Public on purpose. */
const AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const GATE = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const CHAIN_ID = 11155111;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function expectRejection(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "call succeeded but should have been refused");
  } catch (error) {
    check(label, true, (error as Error).message.slice(0, 70));
  }
}

const signer = new LocalAgentSigner(AGENT_KEY);

/** A distinct nonce per proposal, so each one gets its own digest and its own row. */
function proposalWithNonce(nonce: bigint) {
  return buildProposal(
    {
      action: { kind: "send", to: RECIPIENT, valueWei: 10_000_000_000_000_000n },
      chainId: CHAIN_ID,
      gate: GATE,
      nonce,
      chainKey: "sepolia",
      originator: "test",
    },
    signer,
  );
}

async function main() {
  await db.delete(proposals).where(eq(proposals.originator, "test"));

  console.log("\nwrite and read back");
  const { proposal, view } = await proposalWithNonce(9_007_199_254_740_993n);
  const inserted = await insertProposal(db, proposal, view);
  check("insert returns the proposal", inserted.id === proposal.id, inserted.id.slice(0, 12));

  const read = await getProposal(db, proposal.id);
  // A numeric column would round this to ...992. Text plus BigInt is the whole reason for the
  // string columns, and this is the assertion that proves it.
  check("nonce survives above 2^53", read?.nonce === proposal.nonce, String(read?.nonce));
  check("wei survives", read?.call.value === proposal.call.value, String(read?.call.value));
  check("action amounts come back as bigint", typeof read?.action === "object" && read.action.kind === "send" && read.action.valueWei === 10_000_000_000_000_000n);
  check("agentSig persisted", read?.agentSig === proposal.agentSig);
  check("it starts pending", read?.status === "PENDING_HUMAN", read?.status);
  check("pendingProposal finds it", (await pendingProposal(db))?.id === proposal.id);
  check("listProposals includes it", (await listProposals(db)).some((p) => p.id === proposal.id));

  console.log("\nthe one-pending rule");
  const second = await proposalWithNonce(1n);
  await expectRejection("a second proposal while one is pending is refused", () =>
    insertProposal(db, second.proposal, second.view),
  );
  try {
    await insertProposal(db, second.proposal, second.view);
  } catch (error) {
    // The caller's next move is to show the human what they are already being asked to approve,
    // so the error has to carry the pending one rather than just saying no.
    check(
      "the refusal carries the pending proposal",
      error instanceof PendingProposalError && error.pending.id === proposal.id,
    );
  }

  console.log("\ntransitions");
  const moved = await transition(db, proposal.id, "PENDING_HUMAN", "SUBMITTED", {
    humanSig: `0x${"cd".repeat(65)}`,
  });
  check("PENDING_HUMAN -> SUBMITTED", moved.status === "SUBMITTED", moved.status);
  check("the patch was written", moved.humanSig === `0x${"cd".repeat(65)}`);
  check("decidedAt was set", moved.decidedAt !== undefined);

  // Losing this race must stop the loser, not overwrite the winner's decision.
  await expectRejection("a second writer moving from the old status loses", () =>
    transition(db, proposal.id, "PENDING_HUMAN", "REJECTED"),
  );
  const stillSubmitted = await getProposal(db, proposal.id);
  check("the winner's status stands", stillSubmitted?.status === "SUBMITTED", stillSubmitted?.status);

  await expectRejection("an illegal move throws rather than logging", () =>
    transition(db, proposal.id, "SUBMITTED", "PENDING_HUMAN"),
  );
  try {
    await transition(db, proposal.id, "SUBMITTED", "PENDING_HUMAN");
  } catch (error) {
    check("and it is an IllegalTransitionError", error instanceof IllegalTransitionError);
  }

  await expectRejection("moving a proposal that does not exist throws", () =>
    transition(db, `0x${"99".repeat(32)}`, "PENDING_HUMAN", "REJECTED"),
  );
  try {
    await transition(db, `0x${"99".repeat(32)}`, "PENDING_HUMAN", "REJECTED");
  } catch (error) {
    check("and it is a StaleTransitionError", error instanceof StaleTransitionError);
  }

  const executed = await transition(db, proposal.id, "SUBMITTED", "EXECUTED", {
    txHash: `0x${"ef".repeat(32)}`,
  });
  check("SUBMITTED -> EXECUTED", executed.status === "EXECUTED", executed.status);
  check("txHash persisted", executed.txHash === `0x${"ef".repeat(32)}`);

  console.log("\nonce nothing is pending, the next proposal goes in");
  const third = await insertProposal(db, second.proposal, second.view);
  check("insert accepted", third.status === "PENDING_HUMAN", third.id.slice(0, 12));

  await db.delete(proposals).where(eq(proposals.originator, "test"));

  console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
