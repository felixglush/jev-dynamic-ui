"use client";

import { useSyncExternalStore } from "react";

import { CATALOG } from "@/lib/jev/catalog";
import type { ActionName } from "@/lib/jev/types";

/** One confirmed action, as listed in the sidebar. */
export type TakenAction = {
  id: string;
  action: ActionName;
  title: string;
  summary: string;
  /** When it was confirmed, in milliseconds since 1970 (Date.now()). */
  at: number;
};

// Bump the version if the shape above changes, so old saved lists are ignored instead of crashing.
const STORAGE_KEY = "jev:actions-taken:v1";
const NONE: TakenAction[] = [];

/**
 * A tiny store for the sidebar list, kept in localStorage so it survives a reload.
 *
 * React reads it through useSyncExternalStore, which is the supported way to read state that lives
 * outside React. The store must hand back the same array until something changes (React compares
 * with ===), so the parsed list is cached and replaced only on write.
 */
let cache: TakenAction[] | null = null;
const listeners = new Set<() => void>();

function isTakenAction(value: unknown): value is TakenAction {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.action === "string" &&
    Object.hasOwn(CATALOG, entry.action) &&
    typeof entry.title === "string" &&
    typeof entry.summary === "string" &&
    typeof entry.at === "number"
  );
}

function read(): TakenAction[] {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    cache = Array.isArray(parsed) ? parsed.filter(isTakenAction) : NONE;
  } catch {
    // Private windows can block storage, and someone may have hand-edited the value.
    cache = NONE;
  }
  return cache;
}

function write(next: TakenAction[]) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Still works for this visit, just isn't saved.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed the list: drop the cache so the next read picks it up.
  function onStorage(event: StorageEvent) {
    if (event.key !== STORAGE_KEY) return;
    cache = null;
    listener();
  }
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The confirmed actions, newest first. During server rendering there is no localStorage, so the
 * third argument says "empty"; React then fills the real list in right after hydration.
 */
export function useActionsTaken(): TakenAction[] {
  return useSyncExternalStore(subscribe, read, () => NONE);
}

export function recordAction(entry: Omit<TakenAction, "id" | "at">) {
  write([{ ...entry, id: crypto.randomUUID(), at: Date.now() }, ...read()]);
}

export function clearActions() {
  write(NONE);
}

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

function formatAmount(raw: string | undefined) {
  const amount = Number(raw);
  return raw && Number.isFinite(amount) ? money.format(amount) : null;
}

/** Turns "first_home_savings" into "first home savings" for display. */
function words(raw: string | undefined) {
  return raw ? raw.replaceAll("_", " ") : null;
}

/** A one-line description of what the customer confirmed, built from the submitted form values. */
export function summarize(action: ActionName, values: Record<string, string>): string {
  const from = values.from_account ? `from ${words(values.from_account)}` : null;
  let parts: (string | null | undefined)[];
  switch (action) {
    case "add_etransfer_contact":
      parts = [values.name, values.email || values.phone ? `(${values.email || values.phone})` : null];
      break;
    case "send_etransfer":
      parts = [formatAmount(values.amount), values.recipient ? `to ${values.recipient}` : null, from];
      break;
    case "pay_credit_card":
      parts = [
        values.payment_option === "custom" ? formatAmount(values.amount) : `${words(values.payment_option)} payment`,
        from,
      ];
      break;
    case "open_account": {
      const deposit = formatAmount(values.initial_deposit);
      parts = [words(values.account_type), deposit ? `with ${deposit}` : null];
      break;
    }
    default: {
      const unhandled: never = action;
      throw new Error(`No summary for action: ${String(unhandled)}`);
    }
  }
  return parts.filter(Boolean).join(" ");
}
