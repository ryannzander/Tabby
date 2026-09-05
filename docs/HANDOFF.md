# Handoff — picking this up on another machine

Written 2026-09-04, updated the same day at the end of Ryan's first working session.
Everything described here is pushed. `main` is at `4b4b849`.

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

## Your next three moves

You own workstream B. In order:

1. **Issue #2** — the script exists at `apps/web/src/server/agent/spike.ts` and has never run.
   It needs `OPENAI_API_KEY` in `apps/web/.env`. One command, then fill in `docs/spikes.md`
   entry 2 and close the issue.
2. **The proposal store.** `buildProposal` plus the `transition` that throws on an illegal move.
   Pure logic, needs no key and no chain, and M2 cannot start without it. Not started.
3. **Issue #6 (M2)** — chat → agent → proposal → mock approval → transaction on Sepolia. Needs
   @IGanjali to deploy first (issue #5).

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

## Decide this before you write more code

**`b/demo-screen` is pushed but not merged, on purpose.** It is a working chat and wallet screen
with a 128x64 Flipper mock, three new routers, and the T3 example post table deleted. It came out
of a one-line instruction, so every design choice in it is Claude's rather than Ryan's. Read it and
merge it, or delete the branch. Do not leave it rotting.

**Claude was running in bypass permissions mode all session**, which is why it pushed to `main`,
merged its own PR, renamed the repo's contract and built a UI nobody asked for the shape of. Before
the next session, pick one: plan mode (Shift+Tab, proposals need approval before any edit), or a
`permissions.deny` entry on pushing to `main` in `.claude/settings.json`. Nothing has been changed
about this yet.

**Rotate the Supabase password.** It was pasted into a chat transcript. Reset it in the Supabase
dashboard and replace the one line in `apps/web/.env`.

**Open product question, unanswered:** whether the agent only proposes transactions from the wallet
(what the SPEC says today) or also writes and deploys new contracts (what Ryan said out loud). The
second is a much larger feature and is not planned anywhere.

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
