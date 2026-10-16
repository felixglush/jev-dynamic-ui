import { ActionsSidebar } from "@/components/actions-sidebar";
import { Chat } from "@/components/chat";

// A Server Component: it renders on the server and ships only the HTML shell plus the client
// components, which handle typing, the floating card and the saved list of actions.
export default function Home() {
  return (
    <div className="flex flex-1">
      <ActionsSidebar />
      <main
        id="main"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-4 pt-20 pb-[max(4rem,env(safe-area-inset-bottom))] md:pt-12"
      >
        <header className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Banking assistant</h1>
          <p className="text-sm text-pretty text-muted-foreground">
            Tell me what you want to do. I&apos;ll open the right form, pre-filled, for you to confirm.
          </p>
        </header>
        <Chat />
      </main>
    </div>
  );
}
