"use client";

import { useRef, useState, useTransition } from "react";
import { SendHorizontal } from "lucide-react";

import { classifyMessage } from "@/app/actions";
import { ActionPanel } from "@/components/actions/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LOW_CONFIDENCE } from "@/lib/jev/catalog";
import type { ClassifyOutcome } from "@/lib/jev/types";

type Turn = { id: number; text: string; outcome?: ClassifyOutcome };

const EXAMPLES = [
  "Send $50 to Sam for dinner last night",
  "pay the minimum on my credit card from savings",
  "I want to open a TFSA and put 2k in it",
  "add my sister Priya, priya.k@example.com, so I can e-transfer her",
];

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isPending, startTransition] = useTransition();
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);

  function send(text: string) {
    const message = text.trim();
    if (!message || isPending) return;
    const id = nextId.current++;
    setTurns((all) => [...all, { id, text: message }]);
    if (inputRef.current) inputRef.current.value = "";

    // The server action runs on the server; we just await its (plain data) answer.
    startTransition(async () => {
      const outcome = await classifyMessage(message);
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
            <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
              {turn.text}
            </p>
            {!turn.outcome && <p className="text-sm text-muted-foreground">Thinking…</p>}
            {turn.outcome && <Reply outcome={turn.outcome} />}
          </div>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(inputRef.current?.value ?? "");
        }}
        className="sticky bottom-4 flex gap-2 rounded-xl border bg-background p-2 shadow-sm"
      >
        <Input
          ref={inputRef}
          name="message"
          placeholder="What would you like to do?"
          autoComplete="off"
          maxLength={500}
          aria-label="Message"
          className="border-0 shadow-none focus-visible:ring-0"
        />
        <Button type="submit" size="icon" disabled={isPending} aria-label="Send">
          <SendHorizontal />
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
        I can add an e-Transfer contact, send an e-Transfer, pay a credit card, or open an account. Which would you
        like?
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
