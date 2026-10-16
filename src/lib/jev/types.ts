/**
 * Types derived from the catalog. Nothing here is written by hand per action: add an action to
 * CATALOG and these types grow with it.
 */
import type { CATALOG } from "./catalog";

export type Catalog = typeof CATALOG;
export type ActionName = keyof Catalog;

/** The parameter names of action A, e.g. ParamName<"send_etransfer"> is "recipient" | "amount" | ... */
export type ParamName<A extends ActionName> = keyof Catalog[A]["params"] & string;

/** `value` is null when the query doesn't say. Confidence is Jev's confidence in that pick. */
export type ParamValue = { value: string | null; confidence: number | null };

/**
 * One member per action, built by looping over every ActionName. This is a "discriminated union":
 * checking `call.action` tells TypeScript exactly which params exist.
 */
export type ActionCall = {
  [A in ActionName]: {
    action: A;
    /** Jev's confidence that this is the right action. */
    confidence: number;
    params: { [P in ParamName<A>]: ParamValue };
    /** Required parameters the query didn't give; the UI should ask for them. */
    missing: ParamName<A>[];
  };
}[ActionName];

/** The query didn't match any action in the catalog. */
export type NoActionCall = { action: null; confidence: number };

export type ClassifyResult = ActionCall | NoActionCall;

/** What the server action returns to the browser. Plain data only, so it can cross the network. */
export type ClassifyOutcome =
  | { ok: true; result: ClassifyResult }
  | { ok: false; error: string };
