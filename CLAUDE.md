# Flippy the Dolphin — working notes for Claude

A 2-of-2 agent wallet: an AI agent proposes a transaction, a human physically approves it on a
Flipper Zero, and only then does it execute. ETHOnline 2026, testnet only, three people, one week.

Read `docs/SPEC.md` before making design decisions. `docs/DECISIONS.md` lists what is already
settled — do not reopen those without being asked.

## Layout

- `apps/web` — Next.js 15 App Router + tRPC v11 + Drizzle + Tailwind (T3). Chat UI, agent loop,
  wallet panel, mock shop, relayer.
- `apps/bridge` — Node process on the laptop with the Flipper. USB serial, holds the human key in v1.
- `packages/protocol` — shared types, the EIP-712 digest, `HumanSigner`, `MockHumanSigner`.
- `packages/contracts` — Foundry. `FlippyGate` is the 2-of-2 gate.
- `device/flippy-js` — the Flipper app, written in mJS.

## Rules specific to this repo

- **Never edit `packages/protocol/vectors/execute.json`.** It is the frozen proof that Solidity and
  TypeScript produce the same EIP-712 digest, asserted by `test/Digest.t.sol` and `digest.test.ts`.
  If it changes, every signature breaks and the symptom is an unhelpful "bad signature".
- **Never copy an ABI or a shared type.** Import from `@flippy/contracts` / `@flippy/protocol`.
- **Anything reaching the chain or the device goes through `HumanSigner`.** That interface is why
  two thirds of the team can work without hardware. Do not add a code path that bypasses it.
- **Proposal status changes go through the state machine** (`ALLOWED_TRANSITIONS` in protocol).
  An illegal transition should throw, not warn.
- The Flipper JS engine has **no crypto, no bigint, no USB, no exceptions, and no closures**. It
  is mJS, not JavaScript. Do not suggest signing there.

## Commands

```bash
pnpm install
pnpm contracts:test                    # forge test, 13 tests incl. the digest vector
pnpm --filter @flippy/protocol test    # vitest
pnpm typecheck
pnpm dev                               # turbo, all apps
```

If `forge` is not found, Foundry is at `~/.foundry/bin` or `~/.config/.foundry/bin` (when
`XDG_CONFIG_HOME` is set). `./scripts/setup.sh` locates it; do not hardcode either path.

## Style

- Comments explain *why*, not *what*. The existing code is the reference for density.
- Errors should be loud. A missing signer, a mismatched digest or an illegal state transition
  should stop the process, not degrade quietly — a silent failure on stage is unrecoverable.
- Testnet keys are checked in on purpose. Do not treat them as secrets, and do not add real ones.

## Writing

Read `.claude/skills/unslop/SKILL.md` and apply it to everything you write. Chat replies, commit
messages, PR bodies, comments, docs. All of it, every time, without being asked.

The rule that trips Claude most often is #13. No em dashes at all, and no swapping in parentheses
or en dashes to dodge it. End the sentence or use a comma.

The skill is marked `disable-model-invocation`, so it is a standing instruction rather than
something to invoke. `/unslop` runs it as a one-off pass over text that already exists.

## When writing Anthropic API code

Use the `claude-api` skill. Model ids and the thinking/effort parameters have changed recently
and guessing them wastes time. Default model here is `claude-opus-5`.
