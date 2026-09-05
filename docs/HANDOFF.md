# Handoff — picking this up on another machine

Written 2026-09-04. Updated 2026-09-05 at the end of Ryan's second working session.
`main` is at `c2a0b4d`. The session's work is on `b/proposal-store`, which is pushed and not
merged. Read "What happened in session 2" before you branch off anything.

## Get running

```bash
git clone https://github.com/ryannzander/FlippyTheDolphin.git
cd FlippyTheDolphin
./scripts/setup.sh
```

That installs pnpm and Foundry, creates the `.env` files from the examples, and runs both test
suites. It is safe to re-run. When it installs Foundry fresh it prints the exact `export PATH=...`
line to add to your shell profile — the location differs by machine (`~/.foundry/bin` normally,
`~/.config/.foundry/bin` when `XDG_CONFIG_HOME` is set), so copy the line it prints rather than
guessing.

**Verify you're in a good state** — these should pass on a clean clone with no config:

```bash
pnpm contracts:test                    # 13 tests
pnpm --filter @tappy/protocol test    # 8 tests
pnpm --filter @tappy/web test         # 29 tests, on b/proposal-store
pnpm typecheck
```

`pnpm test` at the root will fail unless Foundry is on your PATH, because turbo runs the contracts
suite too. That is a PATH problem, not a broken test.

## What exists and what doesn't

| | State |
|---|---|
| `packages/protocol` | **Working.** Types, EIP-712 digest, `HumanSigner`, `MockHumanSigner`, frozen vector. |
| `packages/contracts` | **Working.** `TappyGate` + mocks, 13 tests, deploy script, ABI export. Not deployed anywhere yet. |
| `apps/bridge` | **Written, never run against hardware.** Serial CLI client and `FlipperHumanSigner` compile and typecheck. Untested on a real Flipper. |
| `device/tappy-js` | **Written, never run.** Same caveat. |
| `apps/web` server | **Half built, on `b/proposal-store`.** Approval channel, proposal store, agent loop. No UI and no tRPC procedure calls any of it. |
| `apps/web` UI | **T3 scaffold only.** The default landing page. Nothing has been designed. |
| `apps/mobile`, `device/tappy-c` | READMEs only. Deliberately not started. |

Nothing is deployed to any chain. `apps/web/.env` has a real `DATABASE_URL`, `BRIDGE_TOKEN` and
`HUMAN_ADDRESS`. There is no `OPENAI_API_KEY` and no `AGENT_PRIVATE_KEY`.

## Read these, in this order

1. `docs/SPEC.md` — architecture, contract design, milestones, cut lines, demo script, risks.
2. `docs/DECISIONS.md` — ten things that are settled. Don't reopen them without a reason.
3. `docs/workstreams/app.md` — your brief (you are workstream B).
4. `docs/spikes.md` — four open unknowns, three of them for hour one.
5. `CONTRIBUTING.md` — branch and PR rules.

## What happened in session 1

Nine commits on `main`, plus one branch that is deliberately not merged.

- The project is **Tappy** now, not Flippy. The contract is `TappyGate` and the EIP-712 domain
  string changed with it, so `vectors/execute.json` was regenerated. Both test suites still agree
  on the new digest. DECISIONS #12.
- The agent runs on **OpenAI `gpt-5.6-terra`**, not Claude. Cost. DECISIONS #11. Tool calls must
  go through `/v1/responses`; GPT-5.6 rejects function tools on `/v1/chat/completions`.
- **Issue #3 is closed.** The approval channel is a polled table, not a socket. It is
  authenticated, and it has been driven end to end against real Postgres. `pnpm --filter
  @tappy/web verify:channel` runs 11 checks.
- **Supabase is live** and the migration is applied. `DATABASE_URL` is in `apps/web/.env`.
- **`.claude/skills/unslop`** is a standing writing rule, wired in through CLAUDE.md.

## What happened in session 2

Two commits, both on `b/proposal-store`, pushed and not merged. Move 2 and half of move 3 from
the old list. 29 vitest cases in `apps/web` and a `verify:store` run against the real Supabase.

- **The proposal store is done.** `src/server/tappy/store.ts` and `proposals.ts`. `callForAction`
  is the single place an `Action` becomes bytes. `transition` is a compare-and-set: `from` is
  matched in the WHERE clause, so two writers racing cannot both win. Illegal moves throw
  `IllegalTransitionError`, lost races throw `StaleTransitionError`, and `insertProposal` refuses
  a second `PENDING_HUMAN` row and puts the pending one on the error.
- **The agent loop is done.** `src/server/agent/loop.ts`. One message in, one reply out, six tool
  round trips maximum. The OpenAI client is an interface, so the whole conversation is tested
  without a key. `tools.ts` holds the six SPEC §3.5 definitions next to their zod schemas.
- **`AgentSigner` takes a `DigestInput`, not a hash.** Privy signs typed data and cannot sign an
  arbitrary 32 bytes, so a `signDigest(hash)` interface would have had one implementation. This
  differs from the sketch in `docs/workstreams/app.md`, deliberately.
- **`b/demo-screen` was deleted**, local and remote. Its design choices were Claude's, not Ryan's.
  The UI starts fresh.
- Two bugs fixed on the way. `proposalToRow` was calling `actionSchema.parse` to fill the jsonb
  column; the schema runs string in, bigint out, so it compiled and would have thrown "Do not know
  how to serialize a BigInt" on the first real write. And `packages/contracts/src-ts/index.ts`
  built its `abis` map from identifiers that do not exist, which typechecked only because nothing
  imported it. Fixed in the generator too, so `forge build` does not undo it.

## Your next three moves

You own workstream B. In order:

1. **`chat.send`.** Nothing calls `runAgentTurn` yet. A tRPC procedure that runs a turn, stores the
   messages and returns the reply. It needs `OPENAI_API_KEY` and `AGENT_PRIVATE_KEY` in
   `apps/web/.env`, and neither is set. Message persistence does not exist either: `db/schema.ts`
   has `proposals` and `signer_sessions`, no `messages`.
2. **`ChainReader` and `ShopReader`.** Both are interfaces in `src/server/agent/handlers.ts` with
   no implementation, because nothing is deployed. `ChainReader` is one viem client and unblocks
   `propose_send` and `propose_swap` end to end. Needs @IGanjali's deploy, issue #5.
3. **Issue #2**, still open. `spike.ts` has never run. One command once the key is set, then fill
   in `docs/spikes.md` entry 2. Do this before trusting the loop on stage.

Then the UI, which nobody has designed. Do not let Claude pick its shape again.

Branch as `b/<thing>`. `main` is protected: both CI checks must pass, no reviews required,
self-merge after 30 minutes if nobody looks.

## Things that will bite you if you forget them

- **Never edit `packages/protocol/vectors/execute.json`.** It's the frozen proof that Solidity and
  TypeScript hash the same bytes. Change it and every signature breaks, and the symptom is an
  unhelpful "bad signature" that tells you nothing about the cause.
- **Never copy an ABI or a shared type into an app.** Import from `@tappy/contracts` and
  `@tappy/protocol`. A drifted copy is a silent revert.
- **On boot, assert `TappyGate.digestOf(...)` equals `proposalDigest(...)`** using the frozen
  vector, and refuse to start if they differ. This one check is the difference between a
  five-minute bug and a five-hour one.
- **The Flipper JS engine is mJS, not JavaScript.** No crypto, no bigint, no USB, no exceptions,
  no closures. It cannot sign. That's why the human key is on the laptop in v1.
- **Don't add prompt-injection defences to the agent tools.** The defence is the human pressing
  Back. That's the whole pitch. See `docs/DECISIONS.md` #10.
- **Amounts cross the tool boundary as strings.** `JSON.stringify` throws on bigint, and the jsonb
  action column stores the zod *input* shape. Anything handing a bigint to the model or to the
  database is a bug that compiles.
- **A failing tool goes back to the model as a result, not an exception.** "No approval device
  connected" is something the user has to be told; a throw ends the turn in silence. This is the
  one place where a loud error means returning it, not raising it.

## Decide this before you write more code

**`b/proposal-store` is pushed and not merged.** Two commits, both green. Review it and merge, or
say what should change. Everything in the next three moves builds on it.

**Add these to `apps/web/.env` and `.env.example`.** Nothing outside the pure tests runs without
them, and the example file was not updated because it sits outside Claude's write permissions.

```
AGENT_SIGNER=local
AGENT_PRIVATE_KEY=      # a testnet key, checked in on purpose per CLAUDE.md
OPENAI_API_KEY=
```

**Rotate the Supabase password.** It was pasted into a chat transcript in session 1. Reset it in
the Supabase dashboard and replace the one line in `apps/web/.env`. Still not done.

**Claude ran in bypass permissions mode in both sessions.** In session 1 that is why it pushed to
`main`, merged its own PR and built a UI nobody asked for the shape of. Session 2 stayed on a
branch and asked before deleting anything, but nothing enforces that. Pick one: plan mode
(Shift+Tab), or a `permissions.deny` on pushing to `main` in `.claude/settings.json`.

**Open product question, unanswered since session 1:** whether the agent only proposes transactions
from the wallet (what the SPEC says today) or also writes and deploys new contracts (what Ryan said
out loud). The second is a much larger feature and is not planned anywhere.

## Still named the old thing, twice over

The project is Tappy (DECISIONS #12) and every package is `@tappy/*`. The GitHub repo was renamed
during session 2 and is now `ryannzander/Tabby`, which matches neither. The clone URL above still
works because GitHub redirects. Pick one spelling and make the repo match.

## Open questions nobody has answered yet

- Arc testnet chain id and RPC (`chains.ts` ships `chainId: 0` and throws, on purpose, so nobody
  deploys against a guess). Assigned to @IGanjali, issue #4.
- Whether Flipper CLI `storage` commands work while a JS app is in the foreground. The entire
  device channel depends on it. Assigned to @AnshuPlayz17, issue #1.
- Expo vs bare React Native for `apps/mobile`. Not urgent; blocks nothing.
- Spike 1 is **still unrun** and it was meant to be hour one. Nobody knows whether the Flipper's
  file commands work while its screen shows a dialog, and the whole device channel rests on it.
  @AnshuPlayz17, issue #1.

## Team

| | Workstream | Owner |
|---|---|---|
| A | contracts, deploys, Privy | @IGanjali |
| B | web app, agent loop, shop | @ryannzander (you) |
| C | Flipper + bridge | @AnshuPlayz17 (has the device) |

Board: https://github.com/ryannzander/FlippyTheDolphin/issues — 11 issues, labelled by workstream
and milestone. Three are labelled `blocker` and belong in hour one.

## Two things I got wrong earlier, already fixed

- `.claude/settings.json` had `"PATH": "${HOME}/.foundry/bin:${PATH}"`. The self-reference doesn't
  expand, so it replaced PATH with a literal string and broke every shell command. Removed —
  Foundry belongs in your own shell profile.
- CI pinned pnpm to `11` while `package.json` pinned `11.25.0`, and `pnpm/action-setup` refuses
  when both are set. The action now reads the version from `packageManager`.
