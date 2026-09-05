# Spike log

One entry per unknown. Date it, answer it, and move on. An unrecorded spike gets re-run by
someone else on day three.

Template:

```
## <n>. <question>  — <owner>, <date>
**Answer:** …
**Evidence:** command run / file / screenshot
**Consequence:** what we do differently now
```

---

## 0. Can a Flipper Zero produce a valid secp256k1 signature? — resolved 2026-09-04, before build
**Answer:** Yes, but only from a C app, at roughly 110–250 ms per signature at 64 MHz.
**Evidence:**
- The JS engine (mJS) has no crypto, no bigint, and no USB access. Its modules are
  `flipper, event_loop, gui, notification, badusb, serial, gpio, math, storage`. `serial` is
  GPIO UART only (`usart`/`lpuart`), so JS cannot reach the USB port at all.
- FlipBIP (`github.com/xtruan/FlipBIP`) runs trezor-crypto's secp256k1 + keccak256 on this
  hardware today via `fap_private_libs`. It derives addresses; it does not sign.
- The firmware's mbedtls has `SECP256K1` disabled and its ECDSA symbols are not linkable from an
  app, so an app must bundle its own curve code.
- micro-ecc measured on Cortex-M4 at 180 MHz: 39.8 ms per secp256k1 sign; scaled to the WB55's
  64 MHz that is ~110–120 ms, and a second published measurement scales to ~250 ms.
- The STM32WB55 **does** have a PKA that natively supports secp256k1 ECDSA (RM0434 Table 150,
  ~82 ms). The SDK exports the LL header, but no Flipper app has used it. Stretch of the stretch.
**Consequence:** v1 uses the JS app as a physical approval button with the human key on the
laptop. On-device signing is M6 and cut line #1. The pitch says "nothing executes without a
physical press" — it only says "the key never leaves the device" if M6 lands. See SPEC §1.

---

## 1. Do Flipper CLI `storage` commands work while a JS app is in the foreground? — <owner C>, TODO hour 1
**Why it matters:** the whole bridge↔device channel depends on it. If it fails there is no other
route from the JS engine to the laptop.
**How to test:** see `docs/workstreams/device.md` → "Hour 0–1 Spike 1". Five steps, no code.
**Fallbacks if it fails:** (a) app polls instead of blocking in the dialog; (b) speak the RPC
protobuf protocol instead of the text CLI; (c) C app owning USB CDC.
**Answer:** _not yet run_

---

## 2. Does one hard-coded model turn reliably produce a `propose_send` tool call? — <owner B>, TODO hour 1
**Why it matters:** the agent loop is ours now, so its failure modes are ours. A model that
argues instead of calling the tool is a broken demo with nobody to blame.
**How to test:** the harness is written — `apps/web/src/server/agent/spike.ts`. Needs an
`OPENAI_API_KEY` in `apps/web/.env` (not in `.env.example` yet — add it), then:

```bash
pnpm --filter @tappy/web spike:agent                        # 4 scenarios x 3 runs, effort=low
pnpm --filter @tappy/web spike:agent -- --effort high       # same, for the latency comparison
pnpm --filter @tappy/web spike:agent -- --only injection --repeat 5
```

Scenarios are `clear`, `vague`, `units` and `injection`. Arguments are `JSON.parse`d and then
validated with zod, never string-matched.
**Known before running:** GPT-5.6 rejects function tools on `/v1/chat/completions` while reasoning
is on, so the spike uses `/v1/responses`. `reasoning.effort` defaults to `medium`; the spike
defaults to `low`.
**Also record:** turn latency at low vs medium effort, behaviour on a vague request, and whether
`injection` gets the model to propose the drain — if it declines, the attack scene (SPEC §9, 1:50)
needs the scripted replay button, and that is a build item, not a retake.
**Answer:** _not yet run — script committed, waiting on an API key_

---

## 3. Where does the approval channel live, given Vercel can't hold a WebSocket? — B, 2026-09-04
**Options:** (a) bridge polls a `pending_approval` row and POSTs the result to tRPC; (b) run the
channel as a local Node process during the demo; (c) Supabase Realtime.
**Answer:** (a). There is no WebSocket. The `web_proposal` row *is* the channel.

**Evidence:** `apps/web/src/server/api/routers/approvals.ts` and the two tables in
`src/server/db/schema.ts`. Four procedures, and the bridge only needs three of them:

| The bridge calls | Carries | Replaces the socket message |
|---|---|---|
| `approvals.hello` | `{ address, kind }` | `signer.hello` |
| `approvals.next` | `{ address }`, poll every 500 ms | `approval.request` |
| `approvals.submit` | `{ decision }` | `approval.result` |

`@tappy/protocol` did not change. The payloads are the same ones SPEC §3.4 defined for the
socket, so this was not a `protocol:` PR and workstream C is not blocked.

**Consequence 1 — nobody waits.** This is the part that is not obvious from the options list.
`propose_*` writes a `PENDING_HUMAN` row and returns immediately, and `approvals.submit` moves it
to `SUBMITTED`. No request is open while the human thinks, which is the only reason this works on
serverless at all. `HumanSigner.requestApproval` returning a `Promise<Decision>` still fits
`MockHumanSigner`, which runs in-process, but the external path never calls it. The relayer picks
the decision up from the row on its next tick.

**Consequence 2 — expiry needs a tick.** Only one proposal may be `PENDING_HUMAN` at a time or the
nonces collide, and a partial unique index enforces it. So a proposal nobody answers blocks every
later one. `approvals.expireStale` exists for the relayer to call; if the relayer is not running,
nothing expires on its own.

**Consequence 3 — polling is the heartbeat.** `approvals.next` bumps `lastSeenAt`, and a signer
counts as connected for 2 s after its last poll. A bridge that dies goes stale by itself. There is
no disconnect message to miss.

**Consequence 4 — the channel needs its own auth.** A socket the bridge dials into is at least a
connection we accept once. Four HTTP endpoints on a public Vercel URL are reachable by anyone who
finds them. So the bridge sends `x-tappy-bridge-token`, and the channel refuses everything while
`BRIDGE_TOKEN` is unset. `approvals.submit` also recovers `humanSig` against `HUMAN_ADDRESS`,
because a token in a laptop `.env` is a weaker secret than a signature. Without that check a leaked
token moves a proposal out of `PENDING_HUMAN` and the real press has nowhere to land. This is not
in tension with DECISIONS #10: that rule is about the agent's tools, not the device's API.

**Cost:** up to 500 ms before the Flipper buzzes, plus one relayer tick after the press. Against a
human reaching for a button and 12 to 30 s of Sepolia inclusion, nobody will see it.

**Not done yet:** no migration has been generated or run. There is no `DATABASE_URL`, so none of
this has touched a real Postgres. `BRIDGE_TOKEN` and `HUMAN_ADDRESS` are not in `.env.example` yet
and both need to be, or the channel stays shut.

---

## 4. Arc testnet chain id, RPC, faucet and explorer — <owner A>, TODO day 1
**Why it matters:** `packages/protocol/src/chains.ts` ships with `chainId: 0` and `chainByKey`
throws on it, deliberately, so nobody deploys against a guess.
**Answer:** _not yet looked up_
