The agent tool-calling loop. See `docs/workstreams/app.md`.

Built:

- `loop.ts` — `runAgentTurn`. One user message in, one reply out, up to 6 tool round trips. Takes
  the client as an interface so tests drive it without a key.
- `tools.ts` — the six definitions from SPEC §3.5, their zod schemas, and the `AgentTools`
  interface the loop calls.
- `prompt.ts` — the system prompt.
- `handlers.ts` — `createAgentTools`, which wires the tools to the proposal store and the signer.
- `spike.ts` — spike 2, unrun. Needs `OPENAI_API_KEY`.

Model is `gpt-5.6-terra` via the OpenAI SDK. Tool calling must go through
`client.responses.create`; GPT-5.6 rejects function tools on `/v1/chat/completions` while
reasoning is on. `arguments` comes back as a JSON string, so `JSON.parse` it and then validate.
`reasoning.effort` defaults to `medium`, which is the main cost lever; the loop uses `low`.

Not wired yet:

- `ChainReader` and `ShopReader` in `handlers.ts` are interfaces, because nothing is deployed
  (issue #5) and the shop tables do not exist. One implementation each and the rest is unchanged.
- No tRPC procedure calls `runAgentTurn` yet. That is `chat.send`.

A failing tool comes back to the model as a result rather than an exception, because the user has
to be told. "No approval device connected" is an answer; a thrown error is silence.
