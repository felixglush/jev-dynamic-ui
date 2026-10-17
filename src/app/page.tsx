import { Chat } from "@/components/chat";

// A Server Component: it renders on the server and ships only the HTML shell plus the <Chat />
// client component, which handles typing and the floating card.
export default function Home() {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 pt-[14dvh] pb-[max(4rem,env(safe-area-inset-bottom))]"
    >
      <header className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Banking assistant</h1>
        <p className="text-sm text-pretty text-muted-foreground">
          Start typing what you want to do. I&apos;ll open the right form and fill it in as you go.
        </p>
      </header>
      <Chat />
    </main>
  );
}
