/**
 * Everything `npm run sft:build` writes, as a pure function so the script and the tests agree.
 *
 * Only approved rows count. Approved sample rows (real messages from data/sample-messages.txt) are
 * split by their id (split.ts) into train, val and test. Approved synthetic rows go to train only, and
 * one that repeats a val or test message is dropped, so the held-out sets stay unseen.
 */
import type { SftRecord } from "./record";
import { messageKey, type ExampleRecord } from "./examples";
import { splitOf, type Split } from "./split";

export function buildSplits(rows: ExampleRecord[]) {
  const files: Record<Split, SftRecord[]> = { train: [], val: [], test: [] };
  const approved = rows.filter((r) => r.meta.status === "approved");
  const record = (r: ExampleRecord): SftRecord => ({ messages: r.messages, meta: r.meta });

  for (const row of approved) if (row.meta.source === "sample") files[splitOf(row.meta.id)].push(record(row));

  const heldOut = new Set([...files.val, ...files.test].map((r) => messageKey(r.meta.action, r.messages[1].content)));
  const dropped: string[] = [];
  for (const row of approved) {
    if (row.meta.source !== "synthetic") continue;
    if (heldOut.has(messageKey(row.meta.action, row.messages[1].content))) dropped.push(row.meta.id);
    else files.train.push(record(row));
  }
  return { files, dropped };
}
