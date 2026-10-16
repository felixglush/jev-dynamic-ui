"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Check, Loader2 } from "lucide-react";

import { classifyMessage } from "@/app/actions";
import { ActionHostContext, type ActionHost } from "@/components/forms/action-form";
import { ActionPanel } from "@/components/forms/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LOW_CONFIDENCE, MAX_MESSAGE_LENGTH } from "@/lib/jev/catalog";
import { summarize } from "@/lib/summarize";
import type { ClassifyOutcome } from "@/lib/jev/types";

const EXAMPLES = [
  "Send $50 to Sam for dinner last night",
  "pay the minimum on my credit card from savings",
  "I want to open a TFSA and put 2k in it",
  "add my sister Priya, priya.k@example.com, so I can e-transfer her",
];

/** How long typing must pause before Jev is asked, and the shortest text worth asking about. */
const DEBOUNCE_MS = 450;
const MIN_LIVE_LENGTH = 3;
/** Matches the fade-out in globals.css; the card's contents are dropped once it has faded. */
const CLOSE_MS = 280;

// Shown when the request itself fails (offline, server restarted), as opposed to Jev failing.
const NETWORK_ERROR: ClassifyOutcome = {
  ok: false,
  error: "Couldn’t reach the server. Check your connection and try again.",
};

export function Chat() {
  // What the card shows. It stays set while the card fades out, then is cleared (see the effect below).
  const [outcome, setOutcome] = useState<ClassifyOutcome | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState("");
  const [, startTransition] = useTransition();

  const composerRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Each question to Jev gets a number. Only the newest one's answer is used, so a slow reply to
  // something typed earlier can never overwrite the card for what is typed now.
  const latestId = useRef(0);
  const lastText = useRef("");
  // Set when the customer pressed Return: once the answer is in, focus moves into the card.
  const wantFocus = useRef(false);

  function ask(text: string, explicit: boolean) {
    const unchanged = text === lastText.current;
    if (unchanged && !explicit) return;
    if (explicit) {
      wantFocus.current = true;
      setOpen(true);
      // Same text as the last answer: nothing new to ask, just move into the card.
      if (unchanged && outcome) {
        focusForm();
        return;
      }
      if (unchanged) return; // that answer is still on its way, and focus will follow it
    }
    const id = ++latestId.current;
    lastText.current = text;

    // The server action runs on the server; we just await its (plain data) answer.
    startTransition(async () => {
      let answer: ClassifyOutcome;
      try {
        answer = await classifyMessage(text);
      } catch {
        answer = NETWORK_ERROR;
      }
      if (latestId.current !== id) return;
      const isAction = answer.ok && answer.result.action !== null;
      // While typing, an unclear message or a hiccup stays quiet; only an explicit Return explains.
      if (!isAction && !explicit) {
        // Forget that this text was asked, so pressing Return on it still gets an explanation.
        lastText.current = "";
        return;
      }
      setOutcome(answer);
      setOpen(true);
    });
  }

  function dismiss() {
    clearTimeout(timer.current);
    latestId.current++; // anything still in flight is now ignored
    lastText.current = "";
    wantFocus.current = false;
    setOpen(false);
    if (composerRef.current) {
      composerRef.current.value = "";
      composerRef.current.focus();
    }
  }

  function onType(value: string) {
    clearTimeout(timer.current);
    const text = value.trim();
    if (!text) {
      if (open) dismiss();
      return;
    }
    if (text.length < MIN_LIVE_LENGTH) return;
    timer.current = setTimeout(() => ask(text, false), DEBOUNCE_MS);
  }

  function focusForm() {
    const card = cardRef.current;
    if (!card) return;
    const target =
      card.querySelector<HTMLElement>('form [aria-invalid="true"]') ??
      card.querySelector<HTMLElement>('form button[type="submit"]');
    if (target) {
      wantFocus.current = false;
      target.focus({ preventScroll: true });
    }
  }

  // Drop the old form's fields from the page once the card has finished fading out.
  useEffect(() => {
    if (open || !outcome) return;
    const t = setTimeout(() => setOutcome(null), CLOSE_MS);
    return () => clearTimeout(t);
  }, [open, outcome]);

  // Stop a pending debounce if the page goes away.
  useEffect(() => () => clearTimeout(timer.current), []);

  // After Return, once the answer has rendered, put the cursor where Return does the right thing:
  // the first field still needed, or else the confirm button.
  useEffect(() => {
    if (!wantFocus.current || !outcome) return;
    wantFocus.current = false;
    focusForm();
  }, [outcome]);

  const host: ActionHost = {
    onConfirm({ title, values }) {
      if (outcome?.ok && outcome.result.action) {
        const summary = summarize(outcome.result.action, values);
        setDone(`${title}${summary ? `: ${summary}` : ""}. Demo only, nothing was submitted.`);
      }
      dismiss();
    },
  };

  function submit(text: string) {
    clearTimeout(timer.current);
    const message = text.trim();
    if (!message) return;
    setDone("");
    ask(message, true);
  }

  return (
    <div
      className="flex w-full flex-col gap-4"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      {/* Blurs the rest of the page while the card is up; clicking it dismisses the card. */}
      <div className="floating-scrim fixed inset-0 z-40" data-open={open} aria-hidden onClick={dismiss} />

      {/* The message bar and the card sit above the blur. The card hangs off the bar's bottom edge. */}
      <div className="relative z-50">
        {/* The text box has no ring of its own, so the whole bar shows focus via focus-within. */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(composerRef.current?.value ?? "");
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
            onChange={(event) => onType(event.target.value)}
            className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon" aria-label="Send" className="size-10 rounded-full">
            <ArrowUp />
          </Button>
        </form>

        {/* Not a modal: the customer keeps typing in the bar above while the form fills itself in. */}
        <div
          ref={cardRef}
          role="dialog"
          aria-label="Your request"
          data-open={open}
          inert={!open}
          className="floating-card absolute inset-x-0 top-full mt-3 max-h-[max(20rem,calc(100dvh-19rem))] overflow-y-auto rounded-[1.75rem] border bg-card text-card-foreground shadow-2xl shadow-black/10"
        >
          <div aria-live="polite" className="py-5">
            {outcome ? (
              <ActionHostContext value={host}>
                <Reply outcome={outcome} />
              </ActionHostContext>
            ) : (
              <Thinking />
            )}
          </div>
        </div>
      </div>

      {/* Always in the page (just empty at first) so screen readers announce the text when it appears.
          Fixed height so the page doesn't shift when the message appears. */}
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
              onClick={() => {
                if (composerRef.current) composerRef.current.value = example;
                submit(example);
              }}
            >
              {example}
            </Button>
          ))}
        </div>
      </div>
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
        I can help with e-Transfers, bills, credit card payments, transfers between your accounts, your cards, and
        more. What would you like to do?
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
      {/* Keyed by action only: the same form keeps its fields (and refills them) as more is typed,
          and a different action replaces the form. */}
      <ActionPanel key={result.action} call={result} />
    </div>
  );
}

function Notice({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-6">
      <p className={`text-sm text-pretty ${className}`}>{children}</p>
      <p className="hidden text-xs text-muted-foreground pointer-fine:block">
        Keep typing to try again, or press <kbd className="rounded bg-muted px-1.5 py-0.5 font-sans">Esc</kbd> to dismiss.
      </p>
    </div>
  );
}
