Everything between a proposal and the chain. See `docs/workstreams/app.md`.

- `store.ts` — persistence + `transition(id, from, to)` that throws on an illegal move.
- `proposals.ts` — builds a proposal: reads the nonce from chain, sets `deadline = now + 600`,
  computes the digest with `@tappy/protocol`, gets the agent signature.
- `agentSigner.ts` — `PrivyAgentSigner | LocalAgentSigner` behind one interface.
- `humanSigner.ts` — `mock` (in-process `MockHumanSigner`) or `external` (the bridge).
- `relayer.ts` — submits `TappyGate.execute`, waits for the receipt.

On boot, assert `TappyGate.digestOf(...)` equals `proposalDigest(...)` using the frozen vector,
and refuse to start if they differ. That check is the difference between a five-minute bug and
a five-hour one.
