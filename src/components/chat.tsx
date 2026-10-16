"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Check, Loader2, X } from "lucide-react";

import { classifyMessage } from "@/app/actions";
import { ActionHostContext, type ActionHost } from "@/components/forms/action-form";
import { ActionPanel } from "@/components/forms/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { recordAction, summarize } from "@/lib/actions-taken";
import { LOW_CONFIDENCE, MAX_MESSAGE_LENGTH } from "@/lib/jev/catalog";
import type { ClassifyOutcome } from "@/lib/jev/types";

/** What the floating card is showing: the message, then Jev's answer once it arrives. */
type Request = { id: number; text: string; outcome?: ClassifyOutcome };

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
  const [request, setRequest] = useState<Request | null>(null);
  const [done, setDone] = useState("");
  const [, startTransition] = useTransition();
  const nextId = useRef(1);
  // The id of the request the card is showing. A slow answer to a dismissed or replaced request is ignored.
  const currentId = useRef(0);
  const composerRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  function send(text: string) {
    const message = text.trim();
    if (!message) return;
    const id = nextId.current++;
    currentId.current = id;
    setRequest({ id, text: message });
    setDone("");
    if (composerRef.current) composerRef.current.value = "";

    // showModal() makes the card a true modal: the page behind is inert, Tab stays inside, and Esc
    // closes it. The CSS in globals.css animates the open and close.
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();

    // The server action runs on the server; we just await its (plain data) answer.
    startTransition(async () => {
      let outcome: ClassifyOutcome;
      try {
        outcome = await classifyMessage(message);
      } catch {
        // Without this, a failed request would leave "Thinking…" on screen forever.
        outcome = NETWORK_ERROR;
      }
      if (currentId.current !== id) return;
      setRequest({ id, text: message, outcome });
    });
  }

  function dismiss() {
    dialogRef.current?.close();
  }

  // When the answer arrives, move focus to where Return does the right thing: the first field the
  // customer still has to fill, or else the confirm button. Skip it if they have started editing.
  const outcome = request?.outcome;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!outcome || !dialog?.open) return;
    const active = document.activeElement;
    if (active !== editRef.current && active !== dialog && active !== document.body) return;
    // defaultValue is the message we sent; a different value means they are revising it, so stay put.
    const edit = editRef.current;
    if (edit && active === edit && edit.value !== edit.defaultValue) return;
    const target =
      dialog.querySelector<HTMLElement>('form [aria-invalid="true"]') ??
      dialog.querySelector<HTMLElement>('form button[type="submit"]');
    target?.focus({ preventScroll: true });
  }, [outcome]);

  const host: ActionHost = {
    onConfirm({ title, values }) {
      if (outcome?.ok && outcome.result.action) {
        const summary = summarize(outcome.result.action, values);
        recordAction({ action: outcome.result.action, title, summary });
        setDone(`${title}${summary ? `: ${summary}` : ""}. Demo only, nothing was submitted.`);
      }
      dismiss();
    },
  };

  return (
    <div className="flex w-full flex-col gap-4">
      {/* The text box has no ring of its own, so the whole bar shows focus via focus-within. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(composerRef.current?.value ?? "");
        }}
        className="flex items-center gap-2 rounded-full border bg-card py-2 pr-2 pl-6 shadow-lg shadow-black/5 transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
      >
        <input
          ref={composerRef}
          name="message"
          placeholder="e.g. Send $50 to Sam for dinner…"
          autoComplete="off"
          maxLength={MAX_MESSAGE_LENGTH}
          aria-label="Message"
          className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="icon" aria-label="Send" className="size-10 rounded-full">
          <ArrowUp />
        </Button>
      </form>

      {/* Always in the page (just empty at first) so screen readers announce the text when it appears. */}
      {/* Fixed height so the page doesn't shift when the message appears. */}
      <p role="status" className="flex h-10 items-center justify-center text-center text-sm text-pretty text-muted-foreground">
        {done && (
          <span key={done} className="animate-rise flex items-center gap-1.5">
            <Check className="size-4 text-success" aria-hidden />
            {done}
          </span>
        )}
      </p>

      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-muted-foreground">Try one of these, or type your own:</p>
        <div className="flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((example) => (
            <Button
              key={example}
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => send(example)}
            >
              {example}
            </Button>
          ))}
        </div>
      </div>

      <dialog
        ref={dialogRef}
        aria-label="Your request"
        onClose={(event) => {
          // A late answer to this request is now ignored.
          currentId.current = 0;
          composerRef.current?.focus();
          // Keep the contents on screen while the card animates out, then drop them so the old
          // form's fields leave the page. Reading a computed style makes the browser start the
          // closing transitions now, so getAnimations() can list them.
          const dialog = event.currentTarget;
          void getComputedStyle(dialog).opacity;
          void Promise.allSettled(dialog.getAnimations().map((a) => a.finished)).then(() => {
            if (!dialog.open) setRequest(null);
          });
        }}
        // Clicking the blurred area outside the card lands on the <dialog> itself.
        onClick={(event) => event.target === event.currentTarget && dismiss()}
        className="floating-card mx-auto mt-[10dvh] max-h-[85dvh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-[1.75rem] border bg-card p-0 text-card-foreground shadow-2xl shadow-black/10"
      >
        {request && (
          <div key={request.id}>
            {/* Looks like the message bar it grew out of. Edit the message and press Return to ask again. */}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                send(editRef.current?.value ?? "");
              }}
              className="flex items-center gap-2 border-b py-3 pr-3 pl-6"
            >
              <input
                ref={editRef}
                defaultValue={request.text}
                // Lands the cursor here when the card opens or a new request replaces the old one.
                autoFocus
                autoComplete="off"
                maxLength={MAX_MESSAGE_LENGTH}
                aria-label="Edit message"
                className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Dismiss"
                className="size-10 rounded-full"
                onClick={dismiss}
              >
                <X />
              </Button>
            </form>

            <div aria-live="polite" className="py-5">
              {request.outcome ? (
                <div className="animate-rise">
                  <ActionHostContext value={host}>
                    <Reply outcome={request.outcome} />
                  </ActionHostContext>
                </div>
              ) : (
                <Thinking />
              )}
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex flex-col gap-3 px-6">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        Thinking…
      </p>
      {/* A rough outline of the form that is coming, so the card doesn't jump as much. */}
      <div className="flex flex-col gap-3" aria-hidden>
        <div className="h-5 w-1/2 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      </div>
    </div>
  );
}

function Reply({ outcome }: { outcome: ClassifyOutcome }) {
  if (!outcome.ok) return <Notice className="text-destructive">{outcome.error}</Notice>;

  const { result } = outcome;
  if (result.action === null) {
    return (
      <Notice className="text-muted-foreground">
        I can add an e-Transfer contact, send an e-Transfer, pay a credit card, or open an account. Which would you
        like?
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {result.confidence < LOW_CONFIDENCE && (
        <Badge variant="warning" className="mx-5">
          Not sure this is what you meant, please check
        </Badge>
      )}
      <ActionPanel call={result} />
    </div>
  );
}

function Notice({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 px-6">
      <p className={`text-sm text-pretty ${className}`}>{children}</p>
      <p className="hidden text-xs text-muted-foreground pointer-fine:block">
        Edit your message above and press <kbd className="rounded bg-muted px-1.5 py-0.5 font-sans">Return</kbd>, or{" "}
        <kbd className="rounded bg-muted px-1.5 py-0.5 font-sans">Esc</kbd> to dismiss.
      </p>
    </div>
  );
}
