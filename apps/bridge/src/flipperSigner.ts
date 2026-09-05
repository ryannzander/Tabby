import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  EXECUTE_TYPES,
  INBOX_PATH,
  OUTBOX_PATH,
  domain,
  flipperResponseSchema,
  type Decision,
  type HumanSigner,
  type ProposalView,
} from "@tappy/protocol";
import type { FlipperCli } from "./flipperCli.js";

export interface TypedMessage {
  nonce: bigint;
  to: Address;
  value: bigint;
  data: Hex;
  deadline: bigint;
}

export interface FlipperSignerOptions {
  privateKey: Hex;
  chainId: number;
  gate: Address;
  cli: FlipperCli;
  pollIntervalMs?: number;
}

/**
 * v1: the Flipper is the physical approval factor; the key stays here on the laptop.
 * The device decides, this class signs. Swapping in an on-device signer (M6) replaces
 * this class only — nothing upstream of HumanSigner changes.
 */
export class FlipperHumanSigner implements HumanSigner {
  private readonly account;
  private readonly pending = new Map<Hex, TypedMessage>();
  private seq = 0;

  constructor(private readonly opts: FlipperSignerOptions) {
    this.account = privateKeyToAccount(opts.privateKey);
  }

  async address(): Promise<Address> {
    return this.account.address;
  }

  register(digest: Hex, message: TypedMessage): void {
    this.pending.set(digest, message);
  }

  async requestApproval(view: ProposalView, timeoutMs: number): Promise<Decision> {
    const seq = ++this.seq;
    const { digest: _digest, ...screen } = view;
    await this.opts.cli.writeFile(INBOX_PATH, JSON.stringify({ ...screen, seq }));

    const approved = await this.awaitDecision(seq, timeoutMs);
    await this.opts.cli.remove(INBOX_PATH);
    await this.opts.cli.remove(OUTBOX_PATH);

    const decision: Decision = {
      id: view.id,
      approved,
      signer: this.account.address,
      at: Date.now(),
    };
    if (!approved) return decision;

    const message = this.pending.get(view.digest);
    if (!message) throw new Error(`FlipperHumanSigner: no message registered for ${view.digest}`);
    decision.humanSig = await this.account.signTypedData({
      domain: domain(this.opts.chainId, this.opts.gate),
      types: EXECUTE_TYPES,
      primaryType: "Execute",
      message,
    });
    return decision;
  }

  /** Polls the outbox until the device answers this seq, or we run out of time. */
  private async awaitDecision(seq: number, timeoutMs: number): Promise<boolean> {
    const interval = this.opts.pollIntervalMs ?? 300;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const raw = await this.opts.cli.readFile(OUTBOX_PATH).catch(() => null);
      if (raw) {
        const parsed = flipperResponseSchema.safeParse(JSON.parse(raw));
        if (parsed.success && parsed.data.seq === seq) return parsed.data.approved;
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    return false; // timeout is a rejection, never a silent approval
  }
}
