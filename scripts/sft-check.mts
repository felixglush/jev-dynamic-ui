/**
 * `npm run sft:check` reports messages that appear in more than one split of the current version.
 * Train against val/test is a failure (exit 1); val against test is only reported, since it never trains.
 */
import { readFileSync } from "node:fs";

import { buildSplits } from "../src/lib/sft/build";
import { normalizeMessage, parseExamples } from "../src/lib/sft/examples";

const { files } = buildSplits(parseExamples(readFileSync("data/sft/examples.jsonl", "utf8")));
const where = new Map<string, Set<string>>();
for (const split of ["train", "val", "test"] as const) {
  for (const row of files[split]) {
    const key = normalizeMessage(row.messages[1].content);
    where.set(key, (where.get(key) ?? new Set()).add(split));
  }
}
const shared = [...where].filter(([, splits]) => splits.size > 1);
const leaks = shared.filter(([, splits]) => splits.has("train"));
for (const [message, splits] of shared) console.log(`${splits.has("train") ? "LEAK" : "held-out twice"}: "${message}" in ${[...splits].join(" + ")}`);
console.log(`${leaks.length} train leaks, ${shared.length - leaks.length} messages in both val and test`);
process.exit(leaks.length ? 1 : 0);
