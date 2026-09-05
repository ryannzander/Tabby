import Link from "next/link";

import { DevicePanel } from "~/app/_components/device-panel";
import { MockNotice } from "~/app/_components/mock-notice";
import { ProposalLine } from "~/app/_components/proposal-line";
import { api } from "~/trpc/server";

export const dynamic = "force-dynamic";

export default async function WalletPage() {
  // One failure here takes the whole screen down, and the reason is always something the operator
  // has to fix (no deploy, no AGENT_MODE). Better shown than swallowed.
  const [mode, summary, pending, recent] = await Promise.all([
    api.wallet.mode(),
    api.wallet.summary(),
    api.wallet.pending(),
    api.wallet.recent(),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 pb-24 pt-10">
      {mode.mock ? <MockNotice /> : null}

      <DevicePanel
        balance={summary.balance}
        chain={summary.chain}
        gate={summary.gate}
        connected={summary.signerConnected}
        pending={pending}
      />

      <section className="mt-12 grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
        <Signatory role="Agent proposes" address={summary.agent} />
        <Signatory role="You approve" address={summary.human} />
      </section>

      <section className="mt-14">
        <h2 className="text-sm font-semibold">Recent</h2>

        {recent.length === 0 ? (
          <p className="mt-3 max-w-[54ch] text-ink-soft">
            Nothing has been proposed yet.{" "}
            <Link href="/chat" className="text-ink underline underline-offset-4">
              Ask Tappy to move some money
            </Link>{" "}
            and it will show up here while it waits for you.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-rule border-t border-rule">
            {recent.map((p) => (
              <ProposalLine key={p.id} {...p} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/**
 * Both keys, named by what they do rather than by "agent address" and "human address". Two
 * signatures on one instrument is the entire product, so the screen says it in those words.
 */
function Signatory({ role, address }: { role: string; address: string }) {
  return (
    <div>
      <div className="text-sm font-semibold">{role}</div>
      <div className="mt-1 font-mono text-sm break-all text-ink-soft">{address}</div>
    </div>
  );
}
