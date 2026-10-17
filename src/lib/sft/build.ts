/**
 * Everything `npm run sft:build` writes, as a pure function so the script and the tests agree.
 *
 * Only approved rows count, and sample and synthetic rows are treated the same (both are AI-written
 * and reviewed on /annotate). They are split per group (split.ts). A row whose message repeats one
 * in val or test is dropped from train, so the held-out sets stay unseen. Rows pinned with `meta.split`
 * (or the older `trainOnly`) are left out of the hash split and go where they are pinned, so adding them
 * never moves another row.
 *
 * Versions: a row with no `meta.version` is v1. `buildSplits(rows)` builds the current version (v5: every
 * row that is not retired); `{ version: "v1" }` to `"v4"` rebuilds an earlier version from the rows that
 * existed then, which must stay identical to the frozen files in data/sft/v1/ to v4/. A row that
 * turns out to be a bad example gets `meta.retired: "v3"`: it stays in the file and in the older versions
 * (so their scores can be reproduced) but is out of v3 and later. Scores are only compared within one version.
 */
import type { SftRecord } from "./record";
import { messageKey, type ExampleRecord } from "./examples";
import { groupOf, pinnedSplit, stratifiedSplit, type Split } from "./split";

export const VERSIONS = ["v1", "v2", "v3", "v4", "v5"] as const;
export type Version = (typeof VERSIONS)[number];
export const CURRENT_VERSION: Version = "v5";
export const rowVersion = (r: ExampleRecord): Version => r.meta.version ?? "v1";
const rank = (v: Version) => VERSIONS.indexOf(v);

/** Is the row part of the sets for `version`? It must have been added by then and not retired by then. */
export const addedBy = (r: ExampleRecord, version: Version) => rank(rowVersion(r)) <= rank(version);
export const inVersion = (r: ExampleRecord, version: Version) => addedBy(r, version) && !(r.meta.retired && rank(r.meta.retired) <= rank(version));

/**
 * Which split each approved row is in for a version: pinned rows go where they are pinned, the rest
 * take the stratified hash split. Rows that are not approved (or not yet added) have no split.
 */
export function assignSplits(rows: ExampleRecord[], version: Version = CURRENT_VERSION): Map<string, Split> {
  const added = rows.filter((r) => r.meta.status === "approved" && addedBy(r, version));
  // Retired rows still take part in the hash split so retiring one never moves another row; they are dropped after.
  const splits = stratifiedSplit(added.filter((r) => !pinnedSplit(r.meta)).map((r) => ({ id: r.meta.id, group: groupOf(r.meta) })));
  for (const r of rows) {
    const pinned = pinnedSplit(r.meta);
    if (pinned && (r.meta.status === "approved" ? addedBy(r, version) : true)) splits.set(r.meta.id, pinned);
  }
  return splits;
}

export function buildSplits(rows: ExampleRecord[], options: { version?: Version } = {}) {
  const files: Record<Split, SftRecord[]> = { train: [], val: [], test: [] };
  const version = options.version ?? CURRENT_VERSION;
  const added = rows.filter((r) => r.meta.status === "approved" && addedBy(r, version));
  const splits = assignSplits(rows, version);
  const approved = added.filter((r) => inVersion(r, version));
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
