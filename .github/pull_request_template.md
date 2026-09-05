## What

<!-- One or two sentences. -->

## Workstream

<!-- A (contracts/protocol) · B (web app) · C (device/bridge) -->

## Checks

- [ ] `pnpm contracts:test` (if Solidity changed)
- [ ] `pnpm --filter @flippy/protocol test` (if protocol changed)
- [ ] `pnpm typecheck`
- [ ] I did not change `packages/protocol/vectors/execute.json`
- [ ] I did not copy an ABI or a shared type into an app

## Does this change an interface others build against?

<!-- If yes, this should be a `protocol:` PR on its own, merged first, and announced. -->
