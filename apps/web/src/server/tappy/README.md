Everything between a proposal and the chain. See `docs/workstreams/app.md`.

Built:

- `store.ts` — persistence + `transition(db, id, from, to)` that throws on an illegal move, and
  refuses a second `PENDING_HUMAN` row because the nonce would collide.
- `proposals.ts` — `buildProposal` and `callForAction`, the one place an `Action` becomes bytes.
  Deadline is `now + 600`, the digest comes from `@tappy/protocol`, the agent signs before the row
  is written.
- `agentSigner.ts` — `AgentSigner` interface + `LocalAgentSigner`. `PrivyAgentSigner` is not
  written yet; `agentSignerFromEnv` throws for `AGENT_SIGNER=privy` rather than falling back.

Not built yet:

- `humanSigner.ts` — `mock` (in-process `MockHumanSigner`) or `external` (the bridge).
- `relayer.ts` — submits `TappyGate.execute`, waits for the receipt.
- The chain client that reads `TappyGate.nonce()`. `buildProposal` takes the nonce as an argument
  until something is deployed; whoever adds the client passes it in and nothing else changes.

On boot, assert `TappyGate.digestOf(...)` equals `proposalDigest(...)` using the frozen vector,
and refuse to start if they differ. That check is the difference between a five-minute bug and
a five-hour one. Still to do, and it needs a deployment.

## Checking it

- `pnpm --filter @tappy/web test` — the pure half: call encoding, the digest the agent signs, the
  state machine, row mapping.
- `pnpm --filter @tappy/web verify:store` — the half only a real Postgres can answer: wei through
  text columns, the compare-and-set in `transition`, the one-pending rule. Needs `DATABASE_URL`.
- `pnpm --filter @tappy/web verify:channel` — the approval channel, spike 3.
