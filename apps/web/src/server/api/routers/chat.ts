/**
 * The chat surface. SPEC §2 step 1, and the workstream B brief.
 *
 * Thin on purpose: `send` builds the model client and the tools, and `~/server/agent/chat` does
 * the rest. That split is what lets a verify script drive the same turn against the real database
 * with a scripted model.
 *
 * BOTH PROCEDURES ARE UNAUTHENTICATED, AND THIS IS NOT SAFE TO DEPLOY AS IT STANDS.
 *
 * There is no auth anywhere in this app yet, so these are `publicProcedure` like everything else.
 * On a public URL that means anyone who finds it can read the whole conversation and write into
 * it. Nothing can move money without the human's press, which is the point of the design, but
 * three things still break:
 *
 * - a stranger spends the OpenAI budget and makes the Flipper buzz during the demo;
 * - one stranger proposal sits at PENDING_HUMAN and `insertProposal` refuses a second, so the real
 *   one is locked out for ten minutes;
 * - the transcript is one global conversation, so a stranger's text is in the history the model
 *   reads on the operator's next turn.
 *
 * This is not covered by DECISIONS #10. That rule is about the agent's tools, where the human's
 * thumb is the defence. `trpc.ts` already draws the same line for the bridge. Decide what guards
 * this before the app is deployed anywhere, at the same time as deciding the UI's shape.
 */

import { z } from "zod";

import { chatHistory, sendChatTurn } from "~/server/agent/chat";
import { agentToolsFromEnv, isMockMode, modelClientFromEnv } from "~/server/agent/context";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

/** Long enough for a real request, short enough that a paste cannot run up a bill. */
export const MAX_MESSAGE_CHARS = 2000;

export const chatRouter = createTRPCRouter({
  history: publicProcedure.query(({ ctx }) => chatHistory(ctx.db)),

  /**
   * Whether anything in this process is real. The UI puts a banner up when it is not, because a
   * screenshot of the mock and a screenshot of the real thing are otherwise identical, and one of
   * them is a made-up balance.
   */
  mode: publicProcedure.query(() => ({ mock: isMockMode() })),

  /**
   * One message in, one reply out. It does not wait for the human: a `propose_*` tool returns as
   * soon as the row is written, and the outcome reaches the conversation on a later turn. See
   * `docs/spikes.md` entry 3.
   *
   * The client and the tools are built per request rather than held in a module, so a missing key
   * is an error on the call that needed it instead of a page that will not load.
   */
  send: publicProcedure
    .input(z.object({ text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS) }))
    .mutation(({ ctx, input }) =>
      sendChatTurn(ctx.db, input.text, {
        client: modelClientFromEnv(),
        tools: agentToolsFromEnv(ctx.db),
      }),
    ),
});
