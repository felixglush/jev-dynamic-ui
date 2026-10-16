"use client";

import { useRef } from "react";
import { CreditCard, History, Landmark, Send, UserPlus, X, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { clearActions, useActionsTaken, type TakenAction } from "@/lib/actions-taken";
import type { ActionName } from "@/lib/jev/types";

// A Record keyed by ActionName fails to compile if a new catalog action has no icon.
const ICONS: Record<ActionName, LucideIcon> = {
  add_etransfer_contact: UserPlus,
  send_etransfer: Send,
  pay_credit_card: CreditCard,
  open_account: Landmark,
};

const time = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" });

/** The list of confirmed actions: a column on wide screens, a slide-over panel on phones. */
export function ActionsSidebar() {
  const actions = useActionsTaken();
  const drawerRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <aside
        aria-label="Actions taken"
        className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r bg-muted/40 md:flex"
      >
        <ActionsList actions={actions} />
      </aside>

      {/* Phones: a button in the corner opens the same list as a panel from the left. */}
      <Button
        variant="outline"
        size="sm"
        className="fixed top-3 left-3 z-10 rounded-full bg-background/80 backdrop-blur md:hidden"
        onClick={() => drawerRef.current?.showModal()}
      >
        <History />
        Actions taken
        <span className="tabular-nums text-muted-foreground">{actions.length}</span>
      </Button>
      <dialog
        ref={drawerRef}
        aria-label="Actions taken"
        // Clicking the dimmed area outside the panel lands on the <dialog> itself, so close then.
        onClick={(event) => event.target === event.currentTarget && event.currentTarget.close()}
        className="drawer m-0 h-dvh max-h-none w-[min(20rem,85vw)] border-r bg-background p-0 text-foreground md:hidden"
      >
        <div className="flex h-full flex-col">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            className="absolute top-3 right-3 rounded-full"
            onClick={() => drawerRef.current?.close()}
          >
            <X />
          </Button>
          <ActionsList actions={actions} />
        </div>
      </dialog>
    </>
  );
}

function ActionsList({ actions }: { actions: TakenAction[] }) {
  return (
    <>
      <div className="flex items-center gap-2 px-5 pt-5 pb-3">
        <h2 className="text-sm font-semibold">Actions taken</h2>
        <span className="rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">{actions.length}</span>
      </div>

      {actions.length === 0 ? (
        <p className="px-5 text-sm text-pretty text-muted-foreground">
          Nothing yet. Actions you confirm will show up here.
        </p>
      ) : (
        <ol className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3" aria-label="Confirmed actions">
          {actions.map((entry) => {
            const Icon = ICONS[entry.action];
            return (
              <li
                key={entry.id}
                className="animate-slide-in flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border bg-background">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.title}</p>
                  {entry.summary && (
                    <p className="truncate text-xs text-muted-foreground" title={entry.summary}>
                      {entry.summary}
                    </p>
                  )}
                </div>
                <time
                  dateTime={new Date(entry.at).toISOString()}
                  className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground"
                >
                  {time.format(entry.at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t px-5 py-3">
        <p className="text-xs text-muted-foreground">Demo only: nothing reaches a bank.</p>
        {actions.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearActions}>
            Clear
          </Button>
        )}
      </div>
    </>
  );
}
