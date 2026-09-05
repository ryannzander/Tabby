# Working on Flippy

Three people, one week, one Flipper between us. These rules exist so nobody waits on anybody.

## The one rule that matters

**Interfaces first, implementations second.** `packages/protocol` defines the types, the EIP-712
digest, and the `HumanSigner` interface. Everything else is written against those. If you need to
change something in `protocol`, that is its own PR, titled `protocol: …`, merged before anything
that depends on it, and announced in the group chat.

## Who owns what

| | Workstream | Owner | Brief |
|---|---|---|---|
| A | contracts + protocol | — | [docs/workstreams/contracts.md](docs/workstreams/contracts.md) |
| B | web app, agent loop, shop | — | [docs/workstreams/app.md](docs/workstreams/app.md) |
| C | Flipper + bridge | the person with the Flipper | [docs/workstreams/device.md](docs/workstreams/device.md) |

Put your names in that table in your first PR.

## Branches

- `main` is always demoable. Never push to it directly.
- Branch names are prefixed with your workstream: `a/gate-deploy`, `b/chat-loop`, `c/serial-cli`.
- Rebase on `main` before opening a PR. Small PRs, squash merge.
- One approving review from either other person. **If nobody has reviewed in 30 minutes, self-merge.**
  Speed beats ceremony this week; `main` staying green is what protects us, not gatekeeping.

## Commits

- Commit at least hourly, even work in progress. ETHGlobal requires visible version history
  throughout the event, and a thin commit log looks like work done before the start.
- Conventional-ish prefixes: `protocol:`, `contracts:`, `web:`, `bridge:`, `device:`, `docs:`.

## Before you open a PR

```bash
pnpm contracts:test                      # if you touched Solidity
pnpm --filter @flippy/protocol test      # if you touched protocol
pnpm typecheck
```

CI runs these on every PR. A red PR does not merge.

## Rules that prevent the three most likely disasters

1. **Never copy an ABI or a type.** Import from `@flippy/contracts` and `@flippy/protocol`.
   A duplicated ABI that drifts is a silent revert on stage.
2. **Never change `packages/protocol/vectors/execute.json`.** It is the frozen cross-language
   proof that Solidity and TypeScript hash the same bytes. If it changes, every signature in the
   system breaks and the failure looks like "bad signature", which tells you nothing.
3. **Never commit a `.env`.** Every key in this repo is testnet-only and disposable, and it stays
   that way because nothing real ever gets added.

## Secrets

Copy `.env.example` to `.env` in each app that has one. The private keys checked into
`.env.example` files and the test vector are well-known Anvil/test keys — public on purpose,
worthless on purpose. Do not replace them with anything you care about.

## Spikes

Unknowns get resolved by experiment and written down in [`docs/spikes.md`](docs/spikes.md) —
one entry, with the date and the answer. An unrecorded spike gets re-run by someone else on
day three.
