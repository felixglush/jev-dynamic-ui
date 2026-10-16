/**
 * Group-stratified train/val/test split.
 *
 * A "group" is an action, plus "(vague)" for messages that don't say enough (the same label the
 * /annotate page shows). Each group is split on its own, so every group lands in all three files
 * in about the same proportions instead of one action being missing from val by bad luck.
 *
 * Inside a group, rows are ordered by a hash of their id and the first ones go to test, the next to
 * val, the rest to train. Hashing (not file order) keeps the split independent of where a row sits;
 * the counts come from the group's size, so the split shifts a little as rows are approved. That is
 * fine: it is only used when `npm run sft:build` writes the files, and rows are all approved by then.
 */
import { createHash } from "node:crypto";

export type Split = "train" | "val" | "test";

/** Change the salt only on purpose: it reshuffles which messages are held out. */
export const SPLIT_SALT = "v4";
export const TEST_PERCENT = 15;
export const VAL_PERCENT = 15;
/** A group smaller than this is all train: holding out one of two rows would leave almost nothing to learn from. */
export const MIN_GROUP_SIZE = 4;

export const groupOf = (meta: { action: string; vague?: boolean }) => meta.action + (meta.vague ? " (vague)" : "");

const order = (id: string) => createHash("sha256").update(`${SPLIT_SALT}:${id}`).digest("hex");

/** Which split each id goes to. Groups of MIN_GROUP_SIZE or more get at least one val and one test row. */
export function stratifiedSplit(rows: { id: string; group: string }[]): Map<string, Split> {
  const byGroup = new Map<string, string[]>();
  for (const { id, group } of rows) byGroup.set(group, [...(byGroup.get(group) ?? []), id]);

  const result = new Map<string, Split>();
  for (const ids of byGroup.values()) {
    ids.sort((a, b) => (order(a) < order(b) ? -1 : 1));
    const held = ids.length >= MIN_GROUP_SIZE;
    const nTest = held ? Math.max(1, Math.round((ids.length * TEST_PERCENT) / 100)) : 0;
    const nVal = held ? Math.max(1, Math.round((ids.length * VAL_PERCENT) / 100)) : 0;
    ids.forEach((id, i) => result.set(id, i < nTest ? "test" : i < nTest + nVal ? "val" : "train"));
  }
  return result;
}
