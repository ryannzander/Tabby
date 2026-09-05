import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string().url(),
    /**
     * Shared secret the bridge sends on every approval-channel call. Optional in the schema so a
     * fresh clone still boots, but `bridgeProcedure` rejects every request while it is unset.
     * Fail closed: an unauthenticated approval channel on a public URL is worse than a dead one.
     */
    BRIDGE_TOKEN: z.string().min(16).optional(),
    /** The address the human key signs with. `approvals.submit` recovers against it. */
    HUMAN_ADDRESS: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
    /**
     * Which key signs as the agent. `local` reads AGENT_PRIVATE_KEY; `privy` is cut line #4 and
     * is not implemented yet. Testnet keys are checked in on purpose, so this is not a secret.
     */
    AGENT_SIGNER: z.enum(["local", "privy"]).default("local"),
    AGENT_PRIVATE_KEY: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    BRIDGE_TOKEN: process.env.BRIDGE_TOKEN,
    HUMAN_ADDRESS: process.env.HUMAN_ADDRESS,
    AGENT_SIGNER: process.env.AGENT_SIGNER,
    AGENT_PRIVATE_KEY: process.env.AGENT_PRIVATE_KEY,
    NODE_ENV: process.env.NODE_ENV,
    // NEXT_PUBLIC_CLIENTVAR: process.env.NEXT_PUBLIC_CLIENTVAR,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
