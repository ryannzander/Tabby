# Decisions

Short log of choices that are settled, so we argue about them once. If you want to reopen one,
say so in the group chat and change this file in the same PR as the code.

| # | Decision | Why | Date |
|---|---|---|---|
| 1 | The Flipper is v1's approval button, not v1's key holder | The JS engine cannot sign; a C signer is a day we do not have on day one. Cut line #1, not the foundation. | 2026-09-04 |
| 2 | Our own chat app, not an MCP connector into claude.ai | We own the UI, so the proposal, its approval state and the tx land on one screen. No tunnel, no OAuth, no connector setup on camera. | 2026-09-04 |
| 3 | Custom 2-of-2 contract, not a Safe | ~70 lines we fully understand, deployable identically on three chains in a minute, no Safe deployment needed on Arc or Hedera testnets. | 2026-09-04 |
| 4 | Both signatures verified on-chain | Makes "2-of-2" literally true. Either key alone is useless, which is the claim we will be asked about. | 2026-09-04 |
| 5 | Sepolia is the build and demo chain; Arc + Hedera are redeploys | Best faucets and tooling for the week; the sponsor deploys are the same bytecode and cost minutes. | 2026-09-04 |
| 6 | Privy server wallet for the agent key, local key behind the same interface | Prize fit and a genuinely better story (the agent never touches a raw key), with a one-env-var escape hatch. | 2026-09-04 |
| 7 | Ledger prize dropped | Cannot serve four sponsors in a week without the product becoming an accessory to integrations. The "why not a Ledger?" answer is in SPEC §9 instead. | 2026-09-04 |
| 8 | "What you see is what you sign" deferred to v2 | The device renders a summary the laptop sends. Honest about it in the README rather than implying otherwise. | 2026-09-04 |
| 9 | T3 stack for the web app | Team strength, one deploy for chat + dashboard + shop, and tRPC gives the React Native client the same typed API later. | 2026-09-04 |
| 10 | The attack scene is never cut | It is the eight seconds that make the physical step the point rather than an accessory. | 2026-09-04 |
| 11 | The agent runs on OpenAI `gpt-5.6-terra`, not `claude-opus-5` | Token cost. Terra is $2/$12 per MTok against Opus 5's $5/$25, and the loop is mostly "pick a tool, fill in args" rather than hard reasoning. Reverses the Agent row of SPEC §5. Nothing else in the architecture is provider-specific — the loop is ours either way. | 2026-09-04 |
