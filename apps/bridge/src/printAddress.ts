import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

/** Workstream A needs this address to deploy the gate. `pnpm --filter @flippy/bridge address` */
const key = process.env.HUMAN_KEY as Hex | undefined;
if (!key) {
  console.error("HUMAN_KEY is not set. Copy apps/bridge/.env.example to .env first.");
  process.exit(1);
}
console.log(privateKeyToAccount(key).address);
