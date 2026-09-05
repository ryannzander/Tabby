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
| A | contracts + protocol | **@IGanjali** | [docs/workstreams/contracts.md](docs/workstreams/contracts.md) |
| B | web app, agent loop, shop | **@ryannzander** | [docs/workstreams/app.md](docs/workstreams/app.md) |
| C | Flipper + bridge | **@AnshuPlayz17** (has the Flipper) | [docs/workstreams/device.md](docs/workstreams/device.md) |

Rough sizing: B is about half the work, A and C a quarter each. If A finishes early they help
B with the shop; if C finishes early they start the on-device signer.

**Only C touches the Flipper.** A and B build against `MockHumanSigner` all week. The test of
whether this split worked is M3: when C swaps the mock for the real device, B's code should not
change by a single line.

### The three moments anyone waits on anyone

1. **Hour 2** — `packages/protocol` is merged. Already done in the scaffold, so this one is free.
2. **M1** — A commits the Sepolia address. B cannot send a real transaction before this, but can
   build everything else against the mock.
3. **M3** — C connects the Flipper. Nothing else is blocked; it replaces one implementation.

Everything else runs in parallel. If you find yourself waiting, say so in the chat — it means an
interface is missing and that is a `protocol:` PR, not a queue.

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
