"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check } from "lucide-react";

import { ActionHostContext, type ActionHost } from "@/components/forms/action-form";
import { ActionPanel } from "@/components/forms/action-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MAX_MESSAGE_LENGTH } from "@/lib/jev/catalog";
import { NOT_CONNECTED_REPLY, SAMPLE_THREAD, type ChatMessage, type Proposal } from "@/lib/agent/messages";

/**
 * The finance agent's chat: a message list and a composer. Everything is local for now. Typing gets a canned
 * reply, and the sample thread shows how proposals open a prefilled form that the customer confirms.
 */
export function AgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(SAMPLE_THREAD);
  // The proposal whose form is open, and the proposals already confirmed.
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const nextId = useRef(SAMPLE_THREAD.length);
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function append(...added: Omit<ChatMessage, "id">[]) {
    const withIds = added.map((message) => ({ ...message, id: `m${++nextId.current}` }) as ChatMessage);
    setMessages((current) => [...current, ...withIds]);
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    append({ role: "user", text: trimmed }, { role: "agent", text: NOT_CONNECTED_REPLY });
  }

  function confirm(proposal: Proposal) {
    setConfirmed((current) => [...current, proposal.id]);
    setOpenProposal(null);
    append({ role: "agent", text: `Done: ${proposal.label.toLowerCase()}. ${proposal.effect}` });
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ol aria-label="Conversation" aria-live="polite" className="flex flex-col gap-4">
        {messages.map((message) => (
          <li key={message.id} className={message.role === "user" ? "flex justify-end" : "flex flex-col gap-3"}>
            {message.role === "user" ? (
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-pretty text-primary-foreground">
                {message.text}
              </p>
            ) : (
              <>
                <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-4 py-2.5 text-sm text-pretty">{message.text}</p>
                {message.proposals?.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    open={openProposal === proposal.id}
                    done={confirmed.includes(proposal.id)}
                    onToggle={() => setOpenProposal((current) => (current === proposal.id ? null : proposal.id))}
                    onConfirm={() => confirm(proposal)}
                  />
                ))}
              </>
            )}
          </li>
        ))}
      </ol>
      <div ref={endRef} />

      {/* The text box has no ring of its own, so the whole bar shows focus via focus-within (as on the demo page). */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem("message") as HTMLInputElement;
          send(input.value);
          input.value = "";
        }}
        className="sticky bottom-4 flex items-center gap-2 rounded-full border bg-card py-2 pr-2 pl-6 shadow-lg shadow-black/5 transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
      >
        <input
          name="message"
          placeholder="Tell me about a goal, or ask how one is going…"
          autoComplete="off"
          maxLength={MAX_MESSAGE_LENGTH}
          aria-label="Message"
          className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="icon" aria-label="Send" className="size-10 rounded-full">
          <ArrowUp />
        </Button>
      </form>
    </div>
  );
}

/** One fix the agent offers. Reviewing it opens the catalog form, prefilled; submitting the form confirms it. */
function ProposalCard({
  proposal,
  open,
  done,
  onToggle,
  onConfirm,
}: {
  proposal: Proposal;
  open: boolean;
  done: boolean;
  onToggle: () => void;
  onConfirm: () => void;
}) {
  const host: ActionHost = { onConfirm };
  return (
    <Card className="max-w-[85%] gap-3 py-4">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{proposal.label}</CardTitle>
          <CardDescription>{proposal.effect}</CardDescription>
        </div>
        {done ? (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4" /> Confirmed
          </span>
        ) : (
          <Button variant={open ? "secondary" : "outline"} size="sm" aria-expanded={open} onClick={onToggle}>
            {open ? "Close" : "Review"}
          </Button>
        )}
      </CardHeader>
      {open && !done && (
        // The form's footer promises that Esc dismisses it, as it does on the demo page.
        <CardContent
          className="px-0"
          onKeyDown={(event) => {
            if (event.key === "Escape") onToggle();
          }}
        >
          <ActionHostContext value={host}>
            <ActionPanel call={proposal.call} />
          </ActionHostContext>
        </CardContent>
      )}
    </Card>
  );
}
