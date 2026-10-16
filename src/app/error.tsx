"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Shown if rendering a page throws. Only for page crashes: chat failures are handled inside <Chat />. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Something Went Wrong</h1>
      <p className="text-muted-foreground">The page hit an unexpected error. Try again, and if it keeps happening, reload.</p>
      <Button onClick={() => retry()}>Try Again</Button>
    </main>
  );
}
