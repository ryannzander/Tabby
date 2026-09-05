# Flippy the Dolphin 🐬

**An AI agent wallet the agent can't drain.** The agent holds one key. You hold the other on a
Flipper Zero. Every transaction is 2-of-2: the agent can propose anything, and nothing moves
until a human physically presses the button.

Built for ETHOnline 2026. Testnet only.

> Agent wallets with spending limits already exist. A policy file is not a person. Flippy's
> second factor is a thumb.

## How it works

```
you → chat → Claude proposes → agent signs → Flipper shows it → you press OK
                                                                       ↓
                                             human signs → FlippyGate.execute() → chain
```

`FlippyGate` is a ~70-line contract that verifies **both** signatures over one EIP-712 digest.
Neither key can move funds alone.

## Repo layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js chat app, wallet dashboard, mock shop, agent loop, relayer (T3 stack) |
| `apps/bridge` | Node process on the laptop: talks to the Flipper over USB, holds the human key (v1) |
| `apps/mobile` | React Native client — placeholder, not started |
| `packages/protocol` | Shared types, EIP-712 digest, the mock signer, the frozen test vector |
| `packages/contracts` | Foundry: `FlippyGate`, `MockToken`, `MockSwap`, `MockMerchant` |
| `device/flippy-js` | The Flipper app (JavaScript) |
| `device/flippy-c` | On-device signing — stretch goal, not started |
| `docs/` | [`SPEC.md`](docs/SPEC.md), per-person briefs, spike log |

## Quick start

```bash
./scripts/setup.sh      # installs pnpm + Foundry, creates .env files, runs the tests
```

Or by hand:

```bash
nvm use                 # Node 22
pnpm install
pnpm contracts:test     # 13 tests, includes the cross-language digest vector
pnpm --filter @flippy/protocol test
```

Foundry is required for the contracts:

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

`foundryup` prints the bin directory to add to your shell profile. It is `~/.foundry/bin` on
most machines, but `~/.config/.foundry/bin` if `XDG_CONFIG_HOME` is set — `./scripts/setup.sh`
finds it either way.

OpenZeppelin comes from pnpm (`foundry.toml` remaps it into `node_modules`), so run
`pnpm install` before `forge test`.

**You do not need a Flipper Zero to work on this.** `MockHumanSigner` satisfies the same
interface as the real device and can auto-approve, auto-reject, or ask you `y/n` in the
terminal. Two thirds of the project is built against it.

## Who's doing what

| | Workstream | Owner | Start here |
|---|---|---|---|
| A | contracts, protocol, deploys | @IGanjali | [brief](docs/workstreams/contracts.md) · [issue #4](https://github.com/ryannzander/FlippyTheDolphin/issues/4) |
| B | web app, agent loop, shop | @ryannzander | [brief](docs/workstreams/app.md) · [issue #2](https://github.com/ryannzander/FlippyTheDolphin/issues/2) |
| C | Flipper + bridge | @AnshuPlayz17 | [brief](docs/workstreams/device.md) · [issue #1](https://github.com/ryannzander/FlippyTheDolphin/issues/1) |

Three issues are labelled `blocker` and should be picked up in hour one. Everything else is
labelled by milestone on the [issue board](https://github.com/ryannzander/FlippyTheDolphin/issues).

## Where to start reading

0. [`docs/HANDOFF.md`](docs/HANDOFF.md) — if you're picking this up on a new machine, start here.
1. [`docs/SPEC.md`](docs/SPEC.md) — architecture, contract design, milestones, cut lines, demo script.
2. Your brief: [`contracts`](docs/workstreams/contracts.md) · [`app`](docs/workstreams/app.md) · [`device`](docs/workstreams/device.md)
3. [`CONTRIBUTING.md`](CONTRIBUTING.md) — branches, PRs, and the rules that keep three people out of each other's way.

## Status

| Milestone | State |
|---|---|
| M0 scaffold, protocol, contracts, mock signer | done |
| M1 gate deployed on Sepolia | not started |
| M2 chat → Claude → proposal → tx | not started |
| M3 Flipper in the loop | not started |
| M4 shop, swap, the attack scene | not started |
| M5 Arc + Hedera + Privy | not started |
| M6 on-device signing (stretch) | not started |

## Honest limitations

- **v1 keeps the human key on the laptop.** The Flipper is the approval factor, not yet the
  custodian. On-device secp256k1 is verified feasible (~0.1–0.3 s per signature) and specced in
  `device/flippy-c/README.md`, but it needs a C app. See SPEC §1.
- **The device shows a summary the laptop sends.** "What you see is what you sign" is v2.
- **A connected laptop can inject button presses** through the Flipper's CLI. In v1 the laptop
  holds the key anyway, so this changes nothing; the C version disables the CLI while running.

Testnet only. Do not put real funds anywhere near this.
