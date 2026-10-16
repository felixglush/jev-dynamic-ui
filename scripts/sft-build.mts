/**
 * Build the fine-tuning files from the hand-labeled seed set.
 *
 *   npm run sft:build            write data/sft/{train,val,test}.jsonl and print a coverage table
 *   npm run sft:build -- --check fail if the files on disk are stale (for CI / before committing)
 *
 * Reads data/sft/seed-labeled.txt (hand-labeled) and the approved rows of data/sft/synthetic.jsonl (generated,
 * reviewed on /annotate), refuses to continue if any label isn't literally in its message,
 * splits per action (src/lib/sft/split.ts) and writes one JSON record per line.
 */
import { readFile, writeFile } from "node:fs/promises";

import { buildSplits } from "../src/lib/sft/build";
import { parseSeed, validateExamples } from "../src/lib/sft/seed";
import { parseSynthetic } from "../src/lib/sft/synthetic";
import type { Split } from "../src/lib/sft/split";

const SEED = "data/sft/seed-labeled.txt";
const SYNTHETIC = "data/sft/synthetic.jsonl";
const check = process.argv.includes("--check");

const examples = parseSeed(await readFile(SEED, "utf8"));
const problems = validateExamples(examples);
if (problems.length > 0) {
  console.error(`${problems.length} label problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

const synthetic = parseSynthetic(await readFile(SYNTHETIC, "utf8").catch(() => ""));
const { files, dropped } = buildSplits(examples, synthetic);
if (dropped.length > 0) console.warn(`Left out ${dropped.length} approved synthetic row(s) that repeat a val/test message: ${dropped.join(", ")}`);
const count = (status: string) => synthetic.filter((r) => r.meta.status === status).length;
console.log(`synthetic: ${count("approved")} approved (in train), ${count("pending")} pending, ${count("rejected")} rejected\n`);

let stale = false;
for (const [split, records] of Object.entries(files)) {
  const path = `data/sft/${split}.jsonl`;
  const text = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
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

// Coverage: per action, how many examples per split, and per field how often a value is stated vs. blank.
const actions = [...new Set(examples.map((e) => e.action))];
console.log("action".padEnd(28), "train  val  test  vague");
for (const action of actions) {
  const count = (split: Split) => files[split].filter((r) => r.meta.action === action).length;
  const vague = examples.filter((e) => e.action === action && e.vague).length;
  console.log(action.padEnd(28), String(count("train")).padStart(5), String(count("val")).padStart(4), String(count("test")).padStart(5), String(vague).padStart(6));
}
console.log(`\ntotal ${examples.length} seed + ${count("approved")} synthetic: train ${files.train.length}, val ${files.val.length}, test ${files.test.length}`);
console.log("\nfield (train only)".padEnd(46), "stated  blank");
for (const action of actions) {
  const rows = files.train.filter((r) => r.meta.action === action);
  const names = rows[0] ? Object.keys(JSON.parse(rows[0].messages[2].content)) : [];
  for (const name of names) {
    const stated = rows.filter((r) => r.meta.present.includes(name)).length;
    console.log(`${action}.${name}`.padEnd(46), String(stated).padStart(6), String(rows.length - stated).padStart(6));
  }
}
