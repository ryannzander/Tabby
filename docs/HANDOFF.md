# Handoff — picking this up on another machine

Written 2026-09-04. Everything described here is pushed to `main` at `56eb88c`.

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
pnpm typecheck
```

## What exists and what doesn't

| | State |
|---|---|
| `packages/protocol` | **Working.** Types, EIP-712 digest, `HumanSigner`, `MockHumanSigner`, frozen vector. |
| `packages/contracts` | **Working.** `TappyGate` + mocks, 13 tests, deploy script, ABI export. Not deployed anywhere yet. |
| `apps/bridge` | **Written, never run against hardware.** Serial CLI client and `FlipperHumanSigner` compile and typecheck. Untested on a real Flipper. |
| `device/tappy-js` | **Written, never run.** Same caveat. |
| `apps/web` | **T3 scaffold only.** `src/server/agent/` and `src/server/tappy/` hold READMEs describing what goes there, not code. |
| `apps/mobile`, `device/tappy-c` | READMEs only. Deliberately not started. |

Nothing is deployed to any chain. No `.env` has real values in it yet.

## Read these, in this order

1. `docs/SPEC.md` — architecture, contract design, milestones, cut lines, demo script, risks.
2. `docs/DECISIONS.md` — ten things that are settled. Don't reopen them without a reason.
3. `docs/workstreams/app.md` — your brief (you are workstream B).
4. `docs/spikes.md` — four open unknowns, three of them for hour one.
5. `CONTRIBUTING.md` — branch and PR rules.

## Your next three moves

You own workstream B. In order:

1. **Issue #2** — one hard-coded model turn that produces a `propose_send` tool call. One script,
   no UI. Model is `gpt-5.6-terra`; tool calls go through `/v1/responses`, not
   `/v1/chat/completions`. Record the result in `docs/spikes.md`.
2. **Issue #3** — done. The bridge polls `approvals.next` and posts to `approvals.submit`.
   No WebSocket, no protocol change. `docs/spikes.md` entry 3 has the reasoning.
3. **Issue #6 (M2)** — chat → agent → proposal → mock approval → transaction on Sepolia. This
   needs @IGanjali to finish issue #5 (deploy) first, so start #2 and #3 while you wait.

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

## Still named the old thing

The project is Tappy now (DECISIONS #12), but the GitHub repo is still `FlippyTheDolphin`, so the
clone URL above is the real one. Rename the repo when convenient. GitHub redirects the old name, so
nothing breaks either way and the URLs above keep working after the rename.

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
