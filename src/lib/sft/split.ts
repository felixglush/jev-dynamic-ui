/**
 * Split examples into train / validation / test, deterministically and per action.
 *
 * Per action ("stratified") so every action has held-out examples; with a plain random split a
 * small action could end up with none. Within an action the order comes from a hash of the id, so
 * the split never changes when the file is re-read, and adding new examples only moves the
 * boundaries a little instead of reshuffling everything.
 */
import { createHash } from "node:crypto";

export type Split = "train" | "val" | "test";

export const HELD_OUT_SHARE = 0.15;

const rank = (action: string, id: string) => createHash("sha256").update(`${action}:${id}`).digest("hex");

export function splitIds(items: { id: string; action: string }[]): Map<string, Split> {
  const byAction = new Map<string, string[]>();
  for (const { id, action } of items) byAction.set(action, [...(byAction.get(action) ?? []), id]);

  const result = new Map<string, Split>();
  for (const [action, ids] of byAction) {
    ids.sort((a, b) => rank(action, a).localeCompare(rank(action, b)));
    // At least one example in each held-out split once an action has 5+, so no action goes untested.
    const heldOut = ids.length >= 5 ? Math.max(1, Math.round(ids.length * HELD_OUT_SHARE)) : 0;
    ids.forEach((id, index) => result.set(id, index < heldOut ? "test" : index < heldOut * 2 ? "val" : "train"));
  }
  return result;
}
