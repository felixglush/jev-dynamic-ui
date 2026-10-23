import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Finance assistant",
  description: "Tell it your financial goals; it keeps an eye on them and tells you when something needs attention.",
};

// A placeholder for the proactive finance agent. Only reachable with AGENT_ENABLED=true (see src/proxy.ts);
// the banking demo at / is untouched either way.
export default function AgentPage() {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 pt-[14dvh] pb-[max(4rem,env(safe-area-inset-bottom))]"
    >
      <header className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Finance assistant</h1>
        <p className="text-sm text-pretty text-muted-foreground">
          Coming soon: tell me what you&apos;re saving for and I&apos;ll keep track of it for you.
        </p>
      </header>
    </main>
  );
}
