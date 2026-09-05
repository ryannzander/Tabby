# Workstream B — Web app (chat, agent loop, wallet, shop)

**Owner:** anyone without the Flipper. **Reads:** `../SPEC.md` §2, §3, §5, §8 Risk 2.
**You never touch hardware.** You develop against `MockHumanSigner` all week. At M3 the bridge
connects and nothing in your code changes.

Everything lives in `apps/web` (T3: Next.js 15 App Router, tRPC v11, Drizzle, Tailwind, Supabase).

## Deliverables
1. Chat UI + the agent tool-calling loop that produces proposals.
2. Wallet panel: balances, both keys, signer status, live proposal list.
3. Approval channel: tRPC procedures the bridge polls. Decided, see `../spikes.md` entry 3.
4. Relayer: submits `TappyGate.execute` once both signatures exist.
5. Mock shop route with an item whose description carries the injection (the attack scene).

## Hour 1 — Spike 2: one model turn, no UI
Before any React. A script (or a `pnpm tsx` one-off) that:
sends one message to `gpt-5.6-terra` with a single `propose_send` tool definition, gets a
`function_call` item back, `JSON.parse`s the arguments, prints them. Record in `docs/spikes.md`: does the
model call the tool reliably, what does it do when the request is vague, how long does a turn take.
Two traps: tool calling must go through `client.responses.create`, because GPT-5.6 rejects
function tools on `/v1/chat/completions` while reasoning is on; and `reasoning.effort`
defaults to `medium`, which costs more than the loop needs.

## Layout inside apps/web
```
src/
  app/
    page.tsx              chat + wallet, side by side (this is the demo screen)
    shop/page.tsx         mock merchant; one item's description contains the injection
                          (no ws route: Vercel cannot hold a socket, see spikes.md entry 3)
  server/
    api/routers/
      chat.ts             chat.send mutation -> agent loop; chat.history query
      wallet.ts           balances, addresses, signer status
      proposals.ts        list, get, live status
      shop.ts             items, invoice creation
    agent/
      loop.ts             OpenAI SDK tool-calling loop, max 6 round trips
      tools.ts            tool definitions (SPEC §3.5)
      prompt.ts           system prompt
    tappy/
      store.ts            proposal persistence + transition(from,to) that throws on illegal moves
      proposals.ts        buildProposal(action): reads nonce from chain, deadline = now + 600,
                          digest via @tappy/protocol, agent signature
      agentSigner.ts      interface { address(); signDigest() }: PrivyAgentSigner | LocalAgentSigner
      approvals.ts        hello / next / submit, the polled channel the bridge calls
      relayer.ts          viem writeContract + receipt -> SUBMITTED/EXECUTED/FAILED
    db/schema.ts          proposals, messages, invoices
```

**Approval channel: decided.** Option (a). The bridge polls `approvals.next` every 500 ms and
posts the result to `approvals.submit`. There is no WebSocket, and `@tappy/protocol` did not
change. Full reasoning and the consequences that are not obvious are in `docs/spikes.md` entry 3.
The one to remember: nothing on the hub ever waits for the human. `propose_*` writes the row and
returns.

## Rules
- Every status change goes through `store.transition(id, from, to)` and throws on an illegal move.
  An illegal transition is a bug, not a log line. `ALLOWED_TRANSITIONS` is in `@tappy/protocol`.
- On boot, call `TappyGate.digestOf(...)` with the frozen vector and compare against
  `proposalDigest()`. Refuse to start on mismatch. This is the Risk #3 guard.
- Refuse a new proposal while one is `PENDING_HUMAN` — the nonce would collide. Return the
  pending one instead.
- If no signer is connected, `propose_*` fails loudly with "no approval device connected".
  Never queue silently.
- Never copy an ABI. Import from `@tappy/contracts`.
- Never redefine a protocol type. Import from `@tappy/protocol`.

## Privy
`@privy-io/server-auth` → `walletApi.ethereum.signTypedData({ walletId, typedData })` behind
`AgentSigner`. If Privy fights you for more than an hour, set `AGENT_SIGNER=local` and move on —
that is cut line #4 and it costs one prize, not the product.

## Milestone checklist
- M0: `pnpm dev` runs the app; `chat.send` returns a canned reply; mock signer wired.
- M1: a test-only tRPC mutation proposes and auto-approves; tx visible on Etherscan.
- M2: real chat → agent → `propose_send` → `cli` mock signer y/n in a terminal → tx → UI updates.
- M3: switch to the external signer; the bridge answers instead. **Zero code change on your side.**
- M4: `/shop` buy flow end to end; swap; the injected drain rendered and rejected.
- M5: `CHAIN_KEY=arc` and `=hedera` work; Privy signs as the agent.
