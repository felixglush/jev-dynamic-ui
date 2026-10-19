import type { ClassifyResult, ParamValue } from "@/lib/jev/types";

/**
 * Decides what the form shows while the customer is still speaking and the transcript keeps changing.
 * The action can switch at once. A field that is still blank fills at once too. A field that already has a
 * value only changes when two answers in a row agree on the new value, so a half-heard word doesn't make
 * the form flicker. Nothing here is used once the final text arrives: that answer is shown as it is.
 *
 * `shown` is what the form holds now, `previous` the last answer Jev and the extractor gave (shown or not),
 * `next` the answer that just arrived.
 */
export function settle(shown: ClassifyResult | null, previous: ClassifyResult | null, next: ClassifyResult): ClassifyResult {
  if (!shown || shown.action === null || next.action === null || shown.action !== next.action) return next;

  const held = shown.params as Record<string, ParamValue>;
  const before = previous?.action === next.action ? (previous.params as Record<string, ParamValue>) : {};
  const params: Record<string, ParamValue> = {};
  for (const [name, value] of Object.entries(next.params as Record<string, ParamValue>)) {
    const current = held[name];
    const repeated = before[name]?.value === value.value;
    params[name] = !current || current.value === null || repeated ? value : current;
  }
  const missing = next.missing.filter((name) => params[name]?.value == null);
  return { ...next, params, missing } as ClassifyResult;
}
