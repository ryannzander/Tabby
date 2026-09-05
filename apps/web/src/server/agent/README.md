The agent tool-calling loop. See `docs/workstreams/app.md`.

Built:

- `loop.ts` — `runAgentTurn`. One user message in, one reply out, up to 6 tool round trips. Takes
  the client as an interface so tests drive it without a key.
- `tools.ts` — the six definitions from SPEC §3.5, their zod schemas, and the `AgentTools`
  interface the loop calls.
- `prompt.ts` — the system prompt.
- `handlers.ts` — `createAgentTools`, which wires the tools to the proposal store and the signer.
- `chat.ts` — `sendChatTurn` and `chatHistory`. The only place chat messages are written.
- `transcript.ts` — the pure half of that: rows to model history, rows to what the UI renders.
- `context.ts` — the model client and the tools, built from the environment, failing by name.
- `spike.ts` — spike 2, unrun. Needs `OPENAI_API_KEY`.
- `verifyChat.ts` — the chat turn against a real Postgres with a scripted model.
  `pnpm --filter @tappy/web verify:chat`. Written but never run: no database on the machine it was
  written on.

Model is `gpt-5.6-terra` via the OpenAI SDK. Tool calling must go through
`client.responses.create`; GPT-5.6 rejects function tools on `/v1/chat/completions` while
reasoning is on. `arguments` comes back as a JSON string, so `JSON.parse` it and then validate.
`reasoning.effort` defaults to `medium`, which is the main cost lever; the loop uses `low`.

Not wired yet:

- `ChainReader` and `ShopReader` in `handlers.ts` are interfaces, because nothing is deployed
  (issue #5) and the shop tables do not exist. One implementation each and the rest is unchanged.
  Until then `agentToolsFromEnv` throws and says so, so `chat.send` fails on the tools rather than
  running the model with none of them.
- Nothing in the UI calls `chat.send`. There is no UI.

A failing tool comes back to the model as a result rather than an exception, because the user has
to be told. "No approval device connected" is an answer; a thrown error is silence.
