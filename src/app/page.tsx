import { Chat } from "@/components/chat";

// A Server Component: it renders on the server and ships only the HTML shell plus the <Chat />
// client component, which handles typing and calls the server action.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Banking assistant</h1>
        <p className="text-sm text-muted-foreground">
          Tell me what you want to do and I&apos;ll open the right form, pre-filled.
        </p>
      </header>
      <Chat />
    </main>
  );
}
