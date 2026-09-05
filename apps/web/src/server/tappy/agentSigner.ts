/**
 * The agent half of the 2-of-2. One interface so a local key and a Privy wallet are swappable,
 * which is cut line #4: if Privy fights us, `AGENT_SIGNER=local` and the demo still runs.
 *
 * The method takes a `DigestInput` rather than a finished hash on purpose. Privy signs typed data
 * (`walletApi.ethereum.signTypedData`) and has no way to sign an arbitrary 32-byte hash, so an
 * interface shaped around `signDigest(hash)` would have only one possible implementation.
 */

import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

import { EXECUTE_TYPES, domain, type DigestInput } from "@tappy/protocol";

import { env } from "~/env";

export interface AgentSigner {
  address(): Promise<Address>;
  signProposal(input: DigestInput): Promise<Hex>;
}

export class LocalAgentSigner implements AgentSigner {
  private readonly account: ReturnType<typeof privateKeyToAccount>;

  constructor(privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
  }

  address(): Promise<Address> {
    return Promise.resolve(this.account.address);
  }

  signProposal(input: DigestInput): Promise<Hex> {
    return this.account.signTypedData({
      domain: domain(input.chainId, input.gate),
      types: EXECUTE_TYPES,
      primaryType: "Execute",
      message: {
        nonce: input.nonce,
        to: input.call.to,
        value: input.call.value,
        data: input.call.data,
        deadline: BigInt(input.deadline),
      },
    });
  }
}

/**
 * Resolved once at boot, not per request, so a missing key is a startup failure rather than a
 * revert three steps later that reads as "bad signature".
 */
export function agentSignerFromEnv(): AgentSigner {
  if (env.AGENT_SIGNER === "privy") {
    throw new Error(
      "AGENT_SIGNER=privy is not implemented yet. Set AGENT_SIGNER=local and AGENT_PRIVATE_KEY.",
    );
  }
  if (!env.AGENT_PRIVATE_KEY) {
    throw new Error("AGENT_SIGNER=local needs AGENT_PRIVATE_KEY. Nothing can be proposed without it.");
  }
  return new LocalAgentSigner(env.AGENT_PRIVATE_KEY as Hex);
}
