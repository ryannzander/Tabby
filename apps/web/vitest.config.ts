import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // Only the pure half of the server runs here. Anything that touches Postgres is covered by
    // the verify scripts instead, because a mocked database proves nothing about the real one.
    include: ["src/server/**/*.test.ts"],
    // `~/env` validates at import. These tests never read a variable, and requiring a DATABASE_URL
    // to unit-test call encoding would make the suite fail on a fresh clone.
    env: { SKIP_ENV_VALIDATION: "1" },
  },
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
