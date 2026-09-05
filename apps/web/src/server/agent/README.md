The agent tool-calling loop. See `docs/workstreams/app.md`.

- `loop.ts` — the agent loop. Cap it at 6 tool round-trips.
- `tools.ts` — tool definitions (SPEC §3.5). Parse inputs with `JSON.parse`, never string matching.
- `prompt.ts` — the system prompt. It must tell the model it can only propose, and never to claim
  success before status is `EXECUTED`.

Model is `gpt-5.6-terra` via the OpenAI SDK (`openai`). Tool calling must go through
`client.responses.create` — GPT-5.6 rejects function tools on `/v1/chat/completions`
while reasoning is on. `arguments` comes back as a JSON string, so `JSON.parse` it.
