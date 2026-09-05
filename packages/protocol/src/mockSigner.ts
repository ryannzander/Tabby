import { createInterface } from "node:readline/promises";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import type { Decision, HumanSigner, ProposalView } from "./types.js";
import { EXECUTE_TYPES, domain } from "./digest.js";

export type MockMode = "auto-approve" | "auto-reject" | "cli";

export interface MockSignerOptions {
  privateKey: Hex;
  mode: MockMode;
  /** Needed to reproduce the same typed-data signature the contract expects. */
  chainId: number;
  gate: Address;
  /** Artificial think time so the UI's pending state is visible in dev. */
  delayMs?: number;
}

export interface TypedMessage {
  nonce: bigint;
  to: Address;
  value: bigint;
  data: Hex;
  deadline: bigint;
}

/**
 * Stand-in for the Flipper. Same interface, same signature, no hardware.
 * Workstreams A and B develop against this all week.
 */
export class MockHumanSigner implements HumanSigner {
  private readonly account;
  private pending = new Map<Hex, TypedMessage>();

  constructor(private readonly opts: MockSignerOptions) {
    this.account = privateKeyToAccount(opts.privateKey);
  }

  async address(): Promise<Address> {
    return this.account.address;
  }

  /** The hub records the message behind a digest before asking for approval. */
  register(digest: Hex, message: TypedMessage): void {
    this.pending.set(digest, message);
  }

  async requestApproval(view: ProposalView, timeoutMs: number): Promise<Decision> {
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
    const approved = await this.decide(view, timeoutMs);
    const decision: Decision = {
      id: view.id,
      approved,
      signer: this.account.address,
      at: Date.now(),
    };
    if (!approved) return decision;

    const message = this.pending.get(view.digest);
    if (!message) throw new Error(`MockHumanSigner: no message registered for ${view.digest}`);
    decision.humanSig = await this.account.signTypedData({
      domain: domain(this.opts.chainId, this.opts.gate),
      types: EXECUTE_TYPES,
      primaryType: "Execute",
      message,
    });
    return decision;
  }

  private async decide(view: ProposalView, timeoutMs: number): Promise<boolean> {
    if (this.opts.mode === "auto-approve") return true;
    if (this.opts.mode === "auto-reject") return false;

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const prompt = [
      "",
      "  ┌─ TAPPY ─ approval request ─────────",
      `  │ ${view.action} ${view.amount}`,
      `  │ to ${view.counterparty}`,
      `  │ ${view.chain}   ${view.short}`,
      "  └───────────────────────────────",
      "  approve? [y/N] ",
    ].join("\n");

    const timer = setTimeout(() => rl.close(), timeoutMs);
    try {
      const answer = await rl.question(prompt);
      return answer.trim().toLowerCase().startsWith("y");
    } catch {
      return false; // stream closed by the timeout
    } finally {
      clearTimeout(timer);
      rl.close();
    }
  }
}
