/**
 * The approval channel (spike 3, issue #3).
 *
 * Vercel route handlers cannot hold a long-lived socket, so there is no WebSocket. The bridge
 * polls `next`, shows the request on the Flipper, and posts the result to `submit`. The database
 * row is the channel.
 *
 * The three procedures carry the same payloads SPEC §3.4 defined for the socket, so
 * `@flippy/protocol` did not change: `hello` takes a `signer.hello`, `next` returns an
 * `approval.request`, `submit` takes an `approval.result`. If we ever do get a socket, the wire
 * shapes are already right.
 */

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import {
  ALLOWED_TRANSITIONS,
  addressSchema,
  decisionSchema,
  hexSchema,
  signerKindSchema,
  type ProposalView,
} from "@flippy/protocol";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { proposals, signerSessions } from "~/server/db/schema";

/** How long a signer counts as connected after its last poll. Four missed polls at 500 ms. */
export const SIGNER_STALE_MS = 2_000;

/** How long the human has before the proposal expires. SPEC sets the deadline at now + 10 min. */
export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export const approvalsRouter = createTRPCRouter({
  /**
   * The bridge announces itself. Exactly one signer may be connected: a second address while
   * another is live is rejected rather than silently queued, because two devices answering the
   * same proposal is worse than no device at all.
   */
  hello: publicProcedure
    .input(z.object({ address: addressSchema, kind: signerKindSchema }))
    .mutation(async ({ ctx, input }) => {
      const staleBefore = new Date(Date.now() - SIGNER_STALE_MS);
      const live = await ctx.db
        .select()
        .from(signerSessions)
        .where(sql`${signerSessions.lastSeenAt} > ${staleBefore}`);

      const other = live.find((s) => s.address !== input.address);
      if (other) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Another signer is already connected: ${other.address} (${other.kind})`,
        });
      }

      await ctx.db
        .insert(signerSessions)
        .values({ address: input.address, kind: input.kind, lastSeenAt: new Date() })
        .onConflictDoUpdate({
          target: signerSessions.address,
          set: { kind: input.kind, lastSeenAt: new Date() },
        });

      return { ok: true as const };
    }),

  /**
   * The bridge polls this. Returns the pending request or null.
   *
   * Claiming is what stops the same request being handed to the device twice: the update only
   * matches a row whose `claimedAt` is still null, so a second concurrent poll gets nothing.
   */
  next: publicProcedure
    .input(z.object({ address: addressSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(signerSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(signerSessions.address, input.address));

      const [claimed] = await ctx.db
        .update(proposals)
        .set({ claimedAt: new Date() })
        .where(and(eq(proposals.status, "PENDING_HUMAN"), isNull(proposals.claimedAt)))
        .returning();

      if (!claimed) return null;

      return {
        t: "approval.request" as const,
        view: claimed.view satisfies ProposalView,
        seq: claimed.seq,
        timeoutMs: APPROVAL_TIMEOUT_MS,
      };
    }),

  /**
   * The human pressed OK or Back. A rejection is final; an approval must carry a signature,
   * because a proposal that reaches the relayer without one reverts on chain with "bad signature"
   * and tells you nothing about why.
   */
  submit: publicProcedure
    .input(z.object({ decision: decisionSchema }))
    .mutation(async ({ ctx, input }) => {
      const { decision } = input;

      if (decision.approved && !decision.humanSig) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Approval for ${decision.id} carries no humanSig`,
        });
      }

      const row = await ctx.db.query.proposals.findFirst({
        where: eq(proposals.id, decision.id),
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: `No proposal ${decision.id}` });
      }

      const next = decision.approved ? "SUBMITTED" : "REJECTED";
      if (!ALLOWED_TRANSITIONS[row.status].includes(next)) {
        // An illegal transition is a bug, not a log line.
        throw new TRPCError({
          code: "CONFLICT",
          message: `Illegal transition ${row.status} -> ${next} for ${decision.id}`,
        });
      }

      await ctx.db
        .update(proposals)
        .set({
          status: next,
          humanSig: decision.humanSig ?? null,
          decidedAt: new Date(decision.at),
        })
        .where(eq(proposals.id, decision.id));

      // The relayer picks it up from here. Nothing waits on this request.
      return { ok: true as const, status: next };
    }),

  /** What the wallet panel shows, and what `propose_*` refuses without. */
  signerStatus: publicProcedure.query(async ({ ctx }) => {
    const staleBefore = new Date(Date.now() - SIGNER_STALE_MS);
    const [live] = await ctx.db
      .select()
      .from(signerSessions)
      .where(sql`${signerSessions.lastSeenAt} > ${staleBefore}`)
      .limit(1);

    if (!live) return { connected: false as const };
    return { connected: true as const, address: live.address, kind: live.kind };
  }),

  /**
   * Expire proposals the human never answered. Called by the relayer tick, not by a request path.
   * Without it a stale PENDING_HUMAN row blocks every later proposal, because only one may be
   * pending at a time.
   */
  expireStale: publicProcedure.mutation(async ({ ctx }) => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await ctx.db
      .update(proposals)
      .set({ status: "EXPIRED", decidedAt: new Date() })
      .where(and(eq(proposals.status, "PENDING_HUMAN"), lt(proposals.deadline, now)))
      .returning({ id: proposals.id });

    return { expired: expired.map((p) => p.id as z.infer<typeof hexSchema>) };
  }),
});
