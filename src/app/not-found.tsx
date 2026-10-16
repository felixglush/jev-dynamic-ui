import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Page Not Found</h1>
      <p className="text-muted-foreground">That page doesn’t exist. Head back to the assistant to pick up where you left off.</p>
      <Link href="/" className={buttonVariants()}>
        Back to the Assistant
      </Link>
    </main>
  );
}
