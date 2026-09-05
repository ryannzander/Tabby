/**
 * What the wallet screen shows.
 *
 * `summary` is the agent's own `get_wallet` tool, called directly rather than reimplemented. The
 * human and the model have to be looking at the same balance: if the screen says 0.49 and the
 * model was told 0.51, whichever one is wrong is invisible until a transaction fails.
 *
 * Unauthenticated, like the rest of the app. See the note at the top of `chat.ts`.
 */

import { agentToolsFromEnv, isMockMode } from "~/server/agent/context";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { listProposalsWithView, pendingProposalWithView } from "~/server/tappy/store";

/** Enough history for the screen without pulling the whole demo back every poll. */
export const RECENT_PROPOSAL_LIMIT = 8;

export const walletRouter = createTRPCRouter({
  summary: publicProcedure.query(({ ctx }) => agentToolsFromEnv(ctx.db).get_wallet()),

  /** The one proposal that can be waiting, or null. At most one is pending by design. */
  pending: publicProcedure.query(async ({ ctx }) => {
    const found = await pendingProposalWithView(ctx.db);
    if (!found) return null;
    return {
      id: found.proposal.id,
      view: found.view,
      deadline: found.proposal.deadline,
      status: found.proposal.status,
    };
  }),

  recent: publicProcedure.query(async ({ ctx }) => {
    const rows = await listProposalsWithView(ctx.db, RECENT_PROPOSAL_LIMIT);
    return rows.map(({ proposal, view }) => ({
      id: proposal.id,
      status: proposal.status,
      view,
      txHash: proposal.txHash ?? null,
      createdAt: proposal.createdAt,
    }));
  }),

  /** Whether any of the above is real. The screen says so when it is not. */
  mode: publicProcedure.query(() => ({ mock: isMockMode() })),
});
