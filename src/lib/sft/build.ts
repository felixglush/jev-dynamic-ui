/**
 * Everything `npm run sft:build` writes, as a pure function so the script and the tests agree.
 *
 * Only approved rows count, and sample and synthetic rows are treated the same (both are AI-written
 * and reviewed on /annotate). They are split per group (split.ts). A row whose message repeats one
 * in val or test is dropped from train, so the held-out sets stay unseen.
 */
import type { SftRecord } from "./record";
import { messageKey, type ExampleRecord } from "./examples";
import { groupOf, stratifiedSplit, type Split } from "./split";

export function buildSplits(rows: ExampleRecord[]) {
  const files: Record<Split, SftRecord[]> = { train: [], val: [], test: [] };
  const approved = rows.filter((r) => r.meta.status === "approved");
  const splits = stratifiedSplit(approved.map((r) => ({ id: r.meta.id, group: groupOf(r.meta) })));
  const key = (r: ExampleRecord) => messageKey(r.meta.action, r.messages[1].content);

  // Held-out rows first. If two held-out rows share a message, the first one stays and the rest are dropped.
  const dropped: string[] = [];
  const heldOut = new Set<string>();
  for (const split of ["test", "val"] as const) {
    for (const row of approved.filter((r) => splits.get(r.meta.id) === split)) {
      if (heldOut.has(key(row))) dropped.push(row.meta.id);
      else {
        heldOut.add(key(row));
        files[split].push({ messages: row.messages, meta: row.meta });
      }
    }
  }
  for (const row of approved.filter((r) => splits.get(r.meta.id) === "train")) {
    if (heldOut.has(key(row))) dropped.push(row.meta.id);
    else files.train.push({ messages: row.messages, meta: row.meta });
  }
  return { files, dropped };
}
