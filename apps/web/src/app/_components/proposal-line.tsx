import type { ProposalStatus, ProposalView } from "@tappy/protocol";

interface Props {
  id: string;
  status: ProposalStatus;
  view: ProposalView;
  txHash: string | null;
  createdAt: number;
}

/**
 * Status carries the meaning, so it is set in the row's own colour rather than in a pill. Three
 * outcomes matter to a reader: it happened, it did not, or it is still up to you.
 */
const TONE: Record<ProposalStatus, string> = {
  PENDING_HUMAN: "text-ink",
  SUBMITTED: "text-ink",
  EXECUTED: "text-confirmed",
  REJECTED: "text-refused",
  FAILED: "text-refused",
  EXPIRED: "text-ink-soft",
};

const WORDING: Record<ProposalStatus, string> = {
  PENDING_HUMAN: "Waiting on you",
  SUBMITTED: "Sending",
  EXECUTED: "Done",
  REJECTED: "You refused it",
  FAILED: "Failed",
  EXPIRED: "Ran out of time",
};

export function ProposalLine({ status, view, txHash, createdAt }: Props) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
      <div className="min-w-0">
        <span>
          {view.action.charAt(0) + view.action.slice(1).toLowerCase()} {view.amount}
        </span>{" "}
        <span className="font-mono text-sm text-ink-soft">{view.counterparty}</span>
      </div>

      <div className="flex items-baseline gap-4">
        <time className="text-sm text-ink-soft" dateTime={new Date(createdAt * 1000).toISOString()}>
          {new Date(createdAt * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        <span className={`text-sm ${TONE[status]}`}>{WORDING[status]}</span>
        {txHash ? (
          <span className="font-mono text-sm text-ink-soft">{txHash.slice(0, 10)}…</span>
        ) : null}
      </div>
    </li>
  );
}
