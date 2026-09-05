# Workstream A — Contracts & Protocol

**Owner:** anyone without the Flipper. **Reads:** `../SPEC.md` §3, §4, §5.
**You unblock everyone.** `packages/protocol` must merge by hour ~2 so B and C can compile against it. (Already scaffolded and green — your job is to keep it correct as things change.)

## Deliverables

1. `packages/protocol` — shared TypeScript: `Proposal`, `Action`, `ProposalView`, `Decision`, `HumanSigner`, WS message types (zod schemas), `proposalDigest()`, `chains.ts`, `MockHumanSigner`, test vector.
2. `packages/contracts` — Foundry: `FlippyGate.sol`, `MockToken.sol`, `MockSwap.sol`, tests, deploy script, `deployments/<chain>.json`, ABI export consumed by hub/dashboard via `@flippy/contracts`.
3. Deploys on Sepolia (M1), Arc testnet and Hedera testnet (M5).

## Order of work

### Hour 0–2: protocol first
- `pnpm init` monorepo skeleton (pnpm workspaces + turbo). Commit immediately.
- `packages/protocol/src/types.ts` exactly as SPEC §3.1–3.4. Export zod schemas alongside types (hub validates every WS message).
- `digest.ts`: `proposalDigest(p)` = viem `hashTypedData` with domain `{ name: "FlippyGate", version: "1", chainId, verifyingContract }` and type `Execute(uint256 nonce,address to,uint256 value,bytes data,uint256 deadline)`.
- `vectors/execute.json`: one fixed proposal (chainId 11155111, a fixed gate address, nonce 0, to, value, data `0x`, deadline) and its expected digest, plus a private key and expected signature. Generate once, freeze.
- `MockHumanSigner`: takes a viem account and `mode`. `cli` mode prints the `ProposalView` and reads `y`/`n` from stdin. `requestApproval` resolves a `Decision` with `humanSig = signTypedData(...)` on approve.
- PR titled `protocol: initial types` → merge. Tell B and C.

### Hour 2–6: FlippyGate
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract FlippyGate is EIP712 {
    bytes32 private constant EXECUTE_TYPEHASH =
        keccak256("Execute(uint256 nonce,address to,uint256 value,bytes data,uint256 deadline)");
    address public immutable agent;
    address public immutable human;
    uint256 public nonce;

    event Executed(uint256 indexed nonce, address indexed to, uint256 value, bytes32 digest, bool ok);
    error Expired(); error BadAgentSig(); error BadHumanSig(); error CallFailed(bytes ret);

    constructor(address _agent, address _human) EIP712("FlippyGate", "1") { agent = _agent; human = _human; }
    receive() external payable {}

    function digestOf(uint256 n, address to, uint256 value, bytes calldata data, uint256 deadline)
        public view returns (bytes32)
    { return _hashTypedDataV4(keccak256(abi.encode(EXECUTE_TYPEHASH, n, to, value, keccak256(data), deadline))); }

    function execute(address to, uint256 value, bytes calldata data, uint256 deadline,
                     bytes calldata agentSig, bytes calldata humanSig) external returns (bytes memory) {
        if (block.timestamp > deadline) revert Expired();
        uint256 n = nonce;
        bytes32 d = digestOf(n, to, value, data, deadline);
        if (ECDSA.recover(d, agentSig) != agent) revert BadAgentSig();
        if (ECDSA.recover(d, humanSig) != human) revert BadHumanSig();
        nonce = n + 1;
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) revert CallFailed(ret);
        emit Executed(n, to, value, d, ok);
        return ret;
    }
}
```
Keep it this small. Expose `digestOf` so the web app can cross-check the TS digest against the chain at startup (Risk #3 guard).

Tests (`test/FlippyGate.t.sol`, use `vm.sign` with two known keys):
- happy path native send; happy path calling `MockSwap`
- wrong agent key, wrong human key, swapped sigs, replay same sigs, expired, inner call reverts → nonce unchanged
- `test/Digest.t.sol`: load `vectors/execute.json` (`vm.readFile` + `vm.parseJson`), assert `digestOf(...)` equals the vector digest and `ECDSA.recover` gives the vector address.

`MockToken`: OZ ERC20 with `mint(address,uint256)` open. `MockSwap`: holds MockToken, `swapExactEthForTokens(uint256 minOut) payable` at `RATE = 1000 tokens per ETH`, reverts if below `minOut`.

### Hour 6–8: deploy (M1)
- `script/Deploy.s.sol`: reads `AGENT_ADDRESS`, `HUMAN_ADDRESS` from env, deploys Gate, MockToken, MockSwap, mints to swap, funds Gate with `0.5 ETH` from deployer. Writes addresses to `deployments/<chain>.json` (`vm.writeJson`).
- `pnpm --filter contracts export-abi` → `packages/contracts/abi/*.json` + `src/index.ts` exporting typed ABIs and `deployments`. apps import from here, never copy.
- Agent address for M1 = the local fallback agent key (B provides); human address = the MockHumanSigner key (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`, from the frozen vector). **Redeploy at M3** with the bridge's real human address, and at M5 with the Privy agent address. Deploys are cheap; keep the script idempotent and the addresses in git.

### Day 1 chain facts (record in `packages/protocol/src/chains.ts`, do not guess)
- Sepolia: chainId 11155111, RPC (Alchemy/Infura key in `.env`), faucet.
- Hedera testnet: chainId 296, JSON-RPC relay URL, faucet (portal.hedera.com). Note: Hedera gas/price quirks; test `execute` there early in M5.
- Arc testnet: look up chainId, RPC, faucet, explorer. Native coin is USDC. Native "ETH" transfers in the contract move USDC there; the dashboard label reads from `chains.ts`.

### M5: Arc + Hedera
Same script, `--rpc-url` per chain, `--legacy` if EIP-1559 unsupported. Verify on their explorers if supported. Commit `deployments/arc.json`, `deployments/hedera.json`.

## Definition of done per milestone
- M0: protocol merged; `forge test` green including Digest vector; vitest for `digest.test.ts` green.
- M1: `deployments/sepolia.json` committed; B has executed one tx through it.
- Note: the scaffold already ships FlippyGate, MockToken, MockSwap, MockMerchant, 13 passing tests and `script/Deploy.s.sol`. Start at "fund accounts and deploy", not at "write the contract".
- M5: three deployment files; the web app's `CHAIN_KEY=arc|hedera|sepolia` switch works.

## Things you must not do
- Change `Execute` type fields or domain after the vector is frozen without a `protocol:` PR and telling everyone.
- Add limits/allowlists/owner rotation. Out of scope by decision.
