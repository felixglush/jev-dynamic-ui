"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, SendHorizontal } from "lucide-react";

import { classifyMessage } from "@/app/actions";
import { ActionPanel } from "@/components/forms/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LOW_CONFIDENCE, MAX_MESSAGE_LENGTH } from "@/lib/jev/catalog";
import type { ClassifyOutcome } from "@/lib/jev/types";

type Turn = { id: number; text: string; outcome?: ClassifyOutcome };

const EXAMPLES = [
  "Send $50 to Sam for dinner last night",
  "pay the minimum on my credit card from savings",
  "I want to open a TFSA and put 2k in it",
  "add my sister Priya, priya.k@example.com, so I can e-transfer her",
];

// Shown when the request itself fails (offline, server restarted), as opposed to Jev failing.
const NETWORK_ERROR: ClassifyOutcome = {
  ok: false,
  error: "Couldn’t reach the server. Check your connection and try again.",
};

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isPending, startTransition] = useTransition();
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view, since the input is pinned to the bottom of the screen.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  function send(text: string) {
    const message = text.trim();
    if (!message || isPending) return;
    const id = nextId.current++;
    setTurns((all) => [...all, { id, text: message }]);
    if (inputRef.current) inputRef.current.value = "";

    // The server action runs on the server; we just await its (plain data) answer.
    startTransition(async () => {
      let outcome: ClassifyOutcome;
      try {
        outcome = await classifyMessage(message);
      } catch {
        // Without this, a failed request would leave "Thinking…" on screen forever.
        outcome = NETWORK_ERROR;
      }
      setTurns((all) => all.map((turn) => (turn.id === id ? { ...turn, outcome } : turn)));
    });
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-6" aria-live="polite">
        {turns.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Try one of these, or type your own:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <Button key={example} variant="outline" size="sm" onClick={() => send(example)}>
                  {example}
                </Button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className="flex flex-col gap-3">
            <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm break-words text-primary-foreground">
              {turn.text}
            </p>
            {turn.outcome ? (
              <Reply outcome={turn.outcome} />
            ) : (
              <p className="text-sm text-muted-foreground">Thinking…</p>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* The text box has no ring of its own, so the whole bar shows focus via focus-within. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(inputRef.current?.value ?? "");
        }}
        className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] flex gap-2 rounded-xl border bg-background p-2 shadow-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
      >
        <Input
          ref={inputRef}
          name="message"
          placeholder="e.g. Send $50 to Sam for dinner…"
          autoComplete="off"
          maxLength={MAX_MESSAGE_LENGTH}
          aria-label="Message"
          className="border-0 shadow-none focus-visible:ring-0"
        />
        <Button type="submit" size="icon" disabled={isPending} aria-label="Send">
          {isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <SendHorizontal />}
        </Button>
      </form>
    </div>
  );
}

function Reply({ outcome }: { outcome: ClassifyOutcome }) {
  if (!outcome.ok) return <p className="text-sm text-destructive">{outcome.error}</p>;

  const { result } = outcome;
  if (result.action === null) {
    return (
      <p className="text-sm text-muted-foreground">
        I can help with e-Transfers, bills, credit card payments, transfers between your accounts, your cards, and
        more. What would you like to do?
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {result.confidence < LOW_CONFIDENCE && (
        <Badge variant="warning">Not sure this is what you meant, please check</Badge>
      )}
      <ActionPanel call={result} />
    </div>
  );
}
