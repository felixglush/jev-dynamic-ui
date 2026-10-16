/**
 * Build the fine-tuning files from the rows you approved on /annotate.
 *
 *   npm run sft:build            write data/sft/{train,val,test}.jsonl and print a coverage table
 *   npm run sft:build -- --check fail if the files on disk are stale (for CI / before committing)
 *
 * Reads data/sft/examples.jsonl. Only approved rows count: rows are split into train, val and
 * test per group (src/lib/sft/split.ts), sample and synthetic alike. Pending and rejected rows are
 * ignored, so the files are empty until something is approved.
 */
import { readFile, writeFile } from "node:fs/promises";

import { buildSplits } from "../src/lib/sft/build";
import { parseExamples } from "../src/lib/sft/examples";
import type { Split } from "../src/lib/sft/split";

const check = process.argv.includes("--check");

const rows = parseExamples(await readFile("data/sft/examples.jsonl", "utf8").catch(() => ""));
const { files, dropped } = buildSplits(rows);
if (dropped.length > 0) console.warn(`Left out ${dropped.length} approved synthetic row(s) that repeat a val/test message: ${dropped.join(", ")}`);

const status = (source: string, state: string) => rows.filter((r) => r.meta.source === source && r.meta.status === state).length;
console.log("rows            approved  pending  rejected");
for (const source of ["sample", "synthetic"]) {
  console.log(source.padEnd(15), [status(source, "approved"), status(source, "pending"), status(source, "rejected")].map((n) => String(n).padStart(8)).join(" "));
}

let stale = false;
for (const [split, records] of Object.entries(files)) {
  const path = `data/sft/${split}.jsonl`;
  const text = records.length ? records.map((record) => JSON.stringify(record)).join("\n") + "\n" : "";
  if (check) {
    const current = await readFile(path, "utf8").catch(() => "");
    if (current !== text) {
      console.error(`${path} is out of date: run npm run sft:build`);
      stale = true;
    }
  } else {
    await writeFile(path, text);
  }
}
if (stale) process.exit(1);

// Coverage: per action, rows per split, and per field how often a value is stated vs. blank in train.
const actions = [...new Set(rows.map((r) => r.meta.action))];
console.log("\naction".padEnd(29), "train  val  test");
for (const action of actions) {
  const count = (split: Split) => files[split].filter((r) => r.meta.action === action).length;
  console.log(action.padEnd(28), String(count("train")).padStart(5), String(count("val")).padStart(4), String(count("test")).padStart(5));
}
console.log(`\ntotal: train ${files.train.length}, val ${files.val.length}, test ${files.test.length}`);
console.log("\nfield (train only)".padEnd(46), "stated  blank");
for (const action of actions) {
  const train = files.train.filter((r) => r.meta.action === action);
  const names = train[0] ? Object.keys(JSON.parse(train[0].messages[2].content)) : [];
  for (const name of names) {
    const stated = train.filter((r) => r.meta.present.includes(name)).length;
    console.log(`${action}.${name}`.padEnd(46), String(stated).padStart(6), String(train.length - stated).padStart(6));
  }
}
