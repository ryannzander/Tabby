The Claude tool-calling loop. See `docs/workstreams/app.md`.

- `loop.ts` — the agent loop. Cap it at 6 tool round-trips.
- `tools.ts` — tool definitions (SPEC §3.5). Parse inputs with `JSON.parse`, never string matching.
- `prompt.ts` — the system prompt. It must tell the model it can only propose, and never to claim
  success before status is `EXECUTED`.

Read the `claude-api` skill before writing any of this. Model is `claude-opus-5`.
