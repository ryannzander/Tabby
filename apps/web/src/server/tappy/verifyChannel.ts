/**
 * End-to-end check of the approval channel against a real Postgres (spike 3, issue #3).
 *
 * Drives the whole path the bridge will drive: announce, poll, sign, submit. Then it tries the
 * two attacks the channel is supposed to refuse, because "the happy path worked once" is not
 * evidence that the guards do anything.
 *
 * Run:  pnpm --filter @tappy/web verify:channel
 *
 * Needs DATABASE_URL, BRIDGE_TOKEN and HUMAN_ADDRESS. Writes and deletes one proposal row.
 */

import { privateKeyToAccount } from "viem/accounts";

import {
  EXECUTE_TYPES,
  domain,
  actionSchema,
  proposalDigest,
  toView,
  type Decision,
} from "@tappy/protocol";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { db } from "~/server/db";
import { proposals, signerSessions } from "~/server/db/schema";
import { eq } from "drizzle-orm";

/** Anvil account #1, the same well-known test key as the frozen vector. Public on purpose. */
const HUMAN_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const GATE = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const CHAIN_ID = 11155111;

function caller(token: string | undefined) {
  const headers = new Headers();
  if (token) headers.set("x-tappy-bridge-token", token);
  return createTRPCContext({ headers }).then(createCaller);
}

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
    check(label, true, (error as Error).message.slice(0, 60));
  }
}

async function main() {
  const token = process.env.BRIDGE_TOKEN;
  if (!token) throw new Error("BRIDGE_TOKEN is not set.");
  const human = privateKeyToAccount(HUMAN_KEY);
  if (human.address.toLowerCase() !== process.env.HUMAN_ADDRESS?.toLowerCase()) {
    throw new Error(`HUMAN_ADDRESS must be ${human.address} for this check.`);
  }

  const bridge = await caller(token);
  const stranger = await caller(undefined);

  // A proposal the hub would have built and agent-signed. Nonce 0, deadline well in the future.
  const nonce = 0n;
  const valueWei = 10_000_000_000_000_000n; // 0.01 ETH
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const call = { to: RECIPIENT, value: valueWei, data: "0x" as const };
  const id = proposalDigest({ chainId: CHAIN_ID, gate: GATE, nonce, call, deadline });
  // Stored shape: amounts as strings, because jsonb goes through JSON.stringify.
  const action = { kind: "send" as const, to: RECIPIENT, valueWei: valueWei.toString() };
  const view = toView({ id, action: actionSchema.parse(action), chainId: CHAIN_ID }, "sepolia");

  await db.delete(proposals).where(eq(proposals.originator, "test"));
  await db.delete(signerSessions).where(eq(signerSessions.address, human.address));

  const row0 = {
    id,
    chainId: CHAIN_ID,
    gate: GATE,
    nonce: nonce.toString(),
    callTo: call.to,
    callValue: call.value.toString(),
    callData: call.data,
    action,
    view,
    deadline,
    status: "PENDING_HUMAN" as const,
    originator: "test" as const,
  };
  await db.insert(proposals).values(row0);

  console.log("\nhappy path");
  await bridge.approvals.hello({ address: human.address, kind: "mock" });
  check("hello accepted", true);

  const status = await bridge.approvals.signerStatus();
  check("signer reads as connected", status.connected);

  const request = await bridge.approvals.next({ address: human.address });
  check("next returned the pending request", request?.view.id === id, request?.view.short);
  check("view renders the amount", request?.view.amount === "0.010 ETH", request?.view.amount);

  const second = await bridge.approvals.next({ address: human.address });
  check("a second poll gets nothing (claimed once)", second === null);

  const humanSig = await human.signTypedData({
    domain: domain(CHAIN_ID, GATE),
    types: EXECUTE_TYPES,
    primaryType: "Execute",
    message: { nonce, to: call.to, value: call.value, data: call.data, deadline: BigInt(deadline) },
  });

  const decision: Decision = { id, approved: true, humanSig, signer: human.address, at: Date.now() };
  const result = await bridge.approvals.submit({ decision });
  check("submit moved it to SUBMITTED", result.status === "SUBMITTED", result.status);

  const row = await db.query.proposals.findFirst({ where: eq(proposals.id, id) });
  check("humanSig persisted", row?.humanSig === humanSig);

  console.log("\nguards");
  await expectRejection("no token is refused", () =>
    stranger.approvals.next({ address: human.address }),
  );
  await expectRejection("wrong token is refused", async () => {
    const bad = await caller("x".repeat(token.length));
    return bad.approvals.next({ address: human.address });
  });
  await expectRejection("a forged signature is refused", async () => {
    const attacker = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const forged = await attacker.signTypedData({
      domain: domain(CHAIN_ID, GATE),
      types: EXECUTE_TYPES,
      primaryType: "Execute",
      message: { nonce, to: call.to, value: call.value, data: call.data, deadline: BigInt(deadline) },
    });
    await db.update(proposals).set({ status: "PENDING_HUMAN" }).where(eq(proposals.id, id));
    return bridge.approvals.submit({
      decision: { id, approved: true, humanSig: forged, signer: attacker.address, at: Date.now() },
    });
  });
  await expectRejection("approving twice is an illegal transition", async () => {
    await db.update(proposals).set({ status: "EXECUTED" }).where(eq(proposals.id, id));
    return bridge.approvals.submit({ decision });
  });

  await expectRejection("a second PENDING_HUMAN row is refused by the index", async () => {
    await db.update(proposals).set({ status: "PENDING_HUMAN" }).where(eq(proposals.id, id));
    await db.insert(proposals).values({ ...row0, id: `${id.slice(0, 64)}ff` });
  });

  await db.delete(proposals).where(eq(proposals.originator, "test"));
  await db.delete(signerSessions).where(eq(signerSessions.address, human.address));

  console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
