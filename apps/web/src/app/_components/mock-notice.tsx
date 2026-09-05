/**
 * Shown whenever `AGENT_MODE=mock`.
 *
 * A screenshot of the mock and a screenshot of the real thing are otherwise identical, and one of
 * them has an invented balance in it. If this is on screen in front of judges, they should be able
 * to read what they are looking at without being told.
 */
export function MockNotice() {
  return (
    <p className="mb-8 border-l-2 border-amber pl-4 text-sm leading-relaxed text-ink-soft">
      <span className="font-semibold text-ink">Stand-in mode.</span> The chain, the approval device
      and the model are all fake. The balance is invented, nothing is signed by a real key, and
      nothing reaches a blockchain. Everything between them is the real code.
    </p>
  );
}
