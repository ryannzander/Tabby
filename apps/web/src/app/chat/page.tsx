import { ChatPanel } from "~/app/_components/chat-panel";
import { MockNotice } from "~/app/_components/mock-notice";
import { api } from "~/trpc/server";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const [mode, history] = await Promise.all([api.wallet.mode(), api.chat.history()]);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-73px)] max-w-3xl flex-col px-6 pb-8 pt-10">
      {mode.mock ? <MockNotice /> : null}
      <ChatPanel initial={history} />
    </main>
  );
}
