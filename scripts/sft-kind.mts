/**
 * Give every row in data/sft/examples.jsonl that has no `meta.kind` a first guess: the kind of its
 * failure pattern if it has one, otherwise a few plain rules on the message (src/lib/sft/kinds.ts).
 * Rows that already have a kind are left alone, so a reviewer's choice is never overwritten.
 *
 *   npm run sft:kind            write the guesses
 *   npm run sft:kind -- --dry   only print the counts
 *   npm run sft:kind -- path    another examples file
 */
import { readFile, writeFile } from "node:fs/promises";

import { guessKind } from "../src/lib/sft/kinds";
import { parseExamples, serializeExamples } from "../src/lib/sft/examples";

const FILE = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "data/sft/examples.jsonl";
const dry = process.argv.includes("--dry");

const records = parseExamples(await readFile(FILE, "utf8"));
const counts = new Map<string, number>();
let added = 0;
const next = records.map((record) => {
  if (record.meta.kind) return record;
  // The row's own stated fields (from its answer), so "missing info" means nothing is stated.
  const answer = JSON.parse(record.messages[2].content) as Record<string, string | number>;
  const stated = Object.fromEntries(Object.entries(answer).filter(([, v]) => v !== "" && v !== 0).map(([k, v]) => [k, String(v)]));
  const kind = guessKind(record.messages[1].content, stated, record.meta.pattern);
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
  added += 1;
  return { ...record, meta: { ...record.meta, kind } };
});
if (!dry) await writeFile(FILE, serializeExamples(next));
console.log(`${dry ? "Would add" : "Added"} a kind to ${added} of ${records.length} rows.`);
for (const [kind, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${kind}: ${n}`);
