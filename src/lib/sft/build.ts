/**
 * Everything `npm run sft:build` writes, as a pure function so the script and the tests agree.
 *
 * Only approved rows count, and sample and synthetic rows are treated the same (both are AI-written
 * and reviewed on /annotate). They are split per group (split.ts). A row whose message repeats one
 * in val or test is dropped from train, so the held-out sets stay unseen. Rows pinned with `meta.split`
 * (or the older `trainOnly`) are left out of the hash split and go where they are pinned, so adding them
 * never moves another row.
 *
 * Versions: a row with no `meta.version` is v1. `buildSplits(rows)` builds the current version (every
 * row); `{ version: "v1" }` rebuilds the v1 sets from the v1 rows alone, which must stay identical to
 * the frozen files in data/sft/v1/. Scores are only compared within one version.
 */
import type { SftRecord } from "./record";
import { messageKey, type ExampleRecord } from "./examples";
import { groupOf, pinnedSplit, stratifiedSplit, type Split } from "./split";

export const rowVersion = (r: ExampleRecord) => r.meta.version ?? "v1";

export function buildSplits(rows: ExampleRecord[], options: { version?: "v1" | "v2" } = {}) {
  const files: Record<Split, SftRecord[]> = { train: [], val: [], test: [] };
  const approved = rows.filter((r) => r.meta.status === "approved" && (options.version !== "v1" || rowVersion(r) === "v1"));
  const splits = stratifiedSplit(approved.filter((r) => !pinnedSplit(r.meta)).map((r) => ({ id: r.meta.id, group: groupOf(r.meta) })));
  for (const r of approved) {
    const pinned = pinnedSplit(r.meta);
    if (pinned) splits.set(r.meta.id, pinned);
  }
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
