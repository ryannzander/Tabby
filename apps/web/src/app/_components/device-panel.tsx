import type { ProposalView } from "@tappy/protocol";

interface Props {
  balance: string;
  chain: string;
  gate: string;
  connected: boolean;
  pending: { id: string; view: ProposalView; deadline: number } | null;
}

/**
 * The one loud thing on the page.
 *
 * It is drawn as the Flipper's screen because that is what the product is: the wallet's balance
 * is not the story, the fact that a physical device stands between the balance and anyone
 * spending it is. When something is waiting, this panel becomes the request, so the screen and
 * the device in your hand are showing the same words at the same time.
 */
export function DevicePanel({ balance, chain, gate, connected, pending }: Props) {
  return (
    <section className="lcd rounded-sm px-6 py-7 sm:px-9 sm:py-10">
      {pending ? (
        <PendingRequest view={pending.view} />
      ) : (
        <>
          <p className="font-pixel text-3xl leading-none sm:text-5xl">{balance}</p>
          <p className="mt-4 max-w-[46ch] text-sm leading-relaxed">
            Held by the gate. Nothing leaves it without a signature from the agent and a press
            from you.
          </p>
        </>
      )}

      <dl className="mt-8 flex flex-wrap items-baseline gap-x-8 gap-y-3 border-t border-ink/25 pt-5 text-sm">
        <Fact label="Chain" value={chain} />
        <Fact label="Gate" value={truncate(gate)} mono />
        <div className="flex items-baseline gap-2">
          <span
            aria-hidden
            className={`inline-block size-2 rounded-full ${
              connected ? "bg-ink blink" : "bg-ink/25"
            }`}
          />
          <span>{connected ? "Device connected" : "No device"}</span>
        </div>
      </dl>
    </section>
  );
}

function PendingRequest({ view }: { view: ProposalView }) {
  return (
    <div>
      <p className="font-pixel text-xl leading-none sm:text-2xl">
        {view.action} {view.amount}
      </p>
      <p className="mt-3 font-mono text-sm break-all">to {view.counterparty}</p>
      <p className="mt-5 max-w-[46ch] text-sm leading-relaxed">
        Waiting for you. Press OK on the device to send it, or Back to refuse. It expires on its
        own if you do nothing.
      </p>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-ink/60">{label}</dt>
      <dd className={mono ? "font-mono" : undefined}>{value}</dd>
    </div>
  );
}

/** Addresses are 42 characters and only the ends carry any information to a reader. */
function truncate(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
