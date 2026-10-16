/**
 * Everything `npm run sft:build` writes, as a pure function so the script and the tests agree.
 *
 * Seed examples are split per action (split.ts). Approved synthetic rows go to train only, and a
 * synthetic row whose message is also in val or test is dropped, so the held-out sets stay unseen.
 */
import { toRecord, type SftRecord } from "./record";
import type { LabeledExample } from "./seed";
import { splitIds, type Split } from "./split";
import { messageKey, type SyntheticRecord } from "./synthetic";

export function buildSplits(seed: LabeledExample[], synthetic: SyntheticRecord[]) {
  const splitOf = splitIds(seed);
  const files: Record<Split, SftRecord[]> = { train: [], val: [], test: [] };
  for (const example of seed) files[splitOf.get(example.id)!].push(toRecord(example));

  const heldOut = new Set([...files.val, ...files.test].map((r) => messageKey(r.meta.action, r.messages[1].content)));
  const dropped: string[] = [];
  for (const record of synthetic) {
    if (record.meta.status !== "approved") continue;
    if (heldOut.has(messageKey(record.meta.action, record.messages[1].content))) dropped.push(record.meta.id);
    else files.train.push({ messages: record.messages, meta: record.meta });
  }
  return { files, dropped };
}
