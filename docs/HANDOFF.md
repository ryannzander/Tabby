# Handoff — picking this up on another machine

Written 2026-09-04. Everything described here is pushed to `main` at `56eb88c`.

## Get running

```bash
git clone https://github.com/ryannzander/FlippyTheDolphin.git
cd FlippyTheDolphin
./scripts/setup.sh
```

That installs pnpm and Foundry, creates the `.env` files from the examples, and runs both test
suites. It is safe to re-run. If Foundry gets installed fresh, add this to your shell profile:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
```

**Verify you're in a good state** — these should pass on a clean clone with no config:

```bash
pnpm contracts:test                    # 13 tests
pnpm --filter @flippy/protocol test    # 8 tests
pnpm typecheck
```

## What exists and what doesn't

| | State |
|---|---|
| `packages/protocol` | **Working.** Types, EIP-712 digest, `HumanSigner`, `MockHumanSigner`, frozen vector. |
| `packages/contracts` | **Working.** `FlippyGate` + mocks, 13 tests, deploy script, ABI export. Not deployed anywhere yet. |
| `apps/bridge` | **Written, never run against hardware.** Serial CLI client and `FlipperHumanSigner` compile and typecheck. Untested on a real Flipper. |
| `device/flippy-js` | **Written, never run.** Same caveat. |
| `apps/web` | **T3 scaffold only.** `src/server/agent/` and `src/server/flippy/` hold READMEs describing what goes there, not code. |
| `apps/mobile`, `device/flippy-c` | READMEs only. Deliberately not started. |

Nothing is deployed to any chain. No `.env` has real values in it yet.

## Read these, in this order

1. `docs/SPEC.md` — architecture, contract design, milestones, cut lines, demo script, risks.
2. `docs/DECISIONS.md` — ten things that are settled. Don't reopen them without a reason.
3. `docs/workstreams/app.md` — your brief (you are workstream B).
4. `docs/spikes.md` — four open unknowns, three of them for hour one.
5. `CONTRIBUTING.md` — branch and PR rules.

## Your next three moves

You own workstream B. In order:

1. **Issue #2** — one hard-coded Claude turn that produces a `propose_send` tool call. One script,
   no UI. Read the `claude-api` skill first; model ids and thinking params changed recently and
   guessing wastes a morning. Model is `claude-opus-5`. Record the result in `docs/spikes.md`.
2. **Issue #3** — decide where the approval channel lives. Vercel can't hold a WebSocket. The
   recommendation is in `docs/spikes.md` entry 3: the bridge polls a row and POSTs results back to
   a tRPC mutation. Boring, works, ~1s latency that nobody will notice.
3. **Issue #6 (M2)** — chat → Claude → proposal → mock approval → transaction on Sepolia. This
   needs @IGanjali to finish issue #5 (deploy) first, so start #2 and #3 while you wait.

Branch as `b/<thing>`. `main` is protected: both CI checks must pass, no reviews required,
self-merge after 30 minutes if nobody looks.

## Things that will bite you if you forget them

- **Never edit `packages/protocol/vectors/execute.json`.** It's the frozen proof that Solidity and
  TypeScript hash the same bytes. Change it and every signature breaks, and the symptom is an
  unhelpful "bad signature" that tells you nothing about the cause.
- **Never copy an ABI or a shared type into an app.** Import from `@flippy/contracts` and
  `@flippy/protocol`. A drifted copy is a silent revert.
- **On boot, assert `FlippyGate.digestOf(...)` equals `proposalDigest(...)`** using the frozen
  vector, and refuse to start if they differ. This one check is the difference between a
  five-minute bug and a five-hour one.
- **The Flipper JS engine is mJS, not JavaScript.** No crypto, no bigint, no USB, no exceptions,
  no closures. It cannot sign. That's why the human key is on the laptop in v1.
- **Don't add prompt-injection defences to the agent tools.** The defence is the human pressing
  Back. That's the whole pitch. See `docs/DECISIONS.md` #10.

## Open questions nobody has answered yet

- Arc testnet chain id and RPC (`chains.ts` ships `chainId: 0` and throws, on purpose, so nobody
  deploys against a guess). Assigned to @IGanjali, issue #4.
- Whether Flipper CLI `storage` commands work while a JS app is in the foreground. The entire
  device channel depends on it. Assigned to @AnshuPlayz17, issue #1.
- Expo vs bare React Native for `apps/mobile`. Not urgent; blocks nothing.

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
