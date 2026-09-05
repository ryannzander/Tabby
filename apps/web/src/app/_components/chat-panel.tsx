"use client";

import { useEffect, useRef, useState } from "react";

import { api, type RouterOutputs } from "~/trpc/react";

type ChatMessage = RouterOutputs["chat"]["history"][number];

export function ChatPanel({ initial }: { initial: ChatMessage[] }) {
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const utils = api.useUtils();
  const bottom = useRef<HTMLDivElement>(null);

  const { data: messages = initial } = api.chat.history.useQuery(undefined, {
    initialData: initial,
  });

  const send = api.chat.send.useMutation({
    onSuccess: async () => {
      setFailure(null);
      // The turn may have written a proposal, so the wallet is stale too.
      await Promise.all([utils.chat.history.invalidate(), utils.wallet.invalidate()]);
    },
    onError: (error) => setFailure(error.message),
  });

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, send.isPending]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || send.isPending) return;
    setDraft("");
    send.mutate({ text });
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !send.isPending ? <Empty /> : null}

        <ul className="space-y-6">
          {messages.map((m) => (
            <Message key={m.seq} message={m} />
          ))}
        </ul>

        {send.isPending ? (
          <p className="mt-6 text-ink-soft">
            <span className="blink">Thinking</span>
          </p>
        ) : null}

        <div ref={bottom} />
      </div>

      {failure ? (
        <p className="mt-6 border-l-2 border-refused pl-4 text-sm leading-relaxed">
          <span className="font-semibold">That did not go through.</span>{" "}
          <span className="text-ink-soft">{failure}</span>
        </p>
      ) : null}

      <form onSubmit={submit} className="mt-6 flex items-end gap-3 border-t border-rule pt-5">
        <label htmlFor="draft" className="sr-only">
          Message
        </label>
        <input
          id="draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Send 0.01 ETH to 0x…"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-2 placeholder:text-ink-soft focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || send.isPending}
          className="shrink-0 bg-ink px-5 py-2 text-paper disabled:opacity-30"
        >
          Send
        </button>
      </form>
    </>
  );
}

/** An empty screen is an invitation to act, and here it is also the pitch in two sentences. */
function Empty() {
  return (
    <div className="max-w-[52ch] py-16">
      <p className="text-2xl leading-snug">Ask Tappy to move some money.</p>
      <p className="mt-4 leading-relaxed text-ink-soft">
        It can send, swap, or buy something from the shop. It cannot do any of it on its own: every
        transaction stops at your device until you press OK.
      </p>
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  const mine = message.role === "user";

  return (
    <li>
      <p className="text-sm font-semibold">{mine ? "You" : "Tappy"}</p>
      <p className="mt-1 max-w-[62ch] leading-relaxed whitespace-pre-wrap">{message.text}</p>

      {message.toolCalls.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {message.toolCalls.map((call, i) => (
            <li key={i} className="font-mono text-sm text-ink-soft">
              {call.error ? "failed " : "ran "}
              {call.name}
              {call.error ? `: ${call.error}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
