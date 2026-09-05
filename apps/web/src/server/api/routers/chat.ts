/**
 * The chat surface. SPEC §2 step 1, and the workstream B brief.
 *
 * Thin on purpose: `send` builds the model client and the tools, and `~/server/agent/chat` does
 * the rest. That split is what lets a verify script drive the same turn against the real database
 * with a scripted model.
 */

import { z } from "zod";

import { chatHistory, sendChatTurn } from "~/server/agent/chat";
import { agentToolsFromEnv, openaiFromEnv } from "~/server/agent/context";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

/** Long enough for a real request, short enough that a paste cannot run up a bill. */
export const MAX_MESSAGE_CHARS = 2000;

export const chatRouter = createTRPCRouter({
  history: publicProcedure.query(({ ctx }) => chatHistory(ctx.db)),

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
        client: openaiFromEnv(),
        tools: agentToolsFromEnv(),
      }),
    ),
});
