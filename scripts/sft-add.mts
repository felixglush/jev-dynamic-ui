/**
 * Add labeled messages to data/sft/examples.jsonl as pending rows, ready to review on /annotate.
 *
 *   npm run sft:add -- path/to/batch.txt [--source sample|synthetic] [--split train|val|test]
 *                      [--pattern name] [--version v1|v2|v3] [--train-only]    (default source: synthetic)
 *
 * The batch is plain text, one example per line: `message => field=value; field=value`, with
 * `# <action>` headers. "sample" rows are real messages that can end up in val or test once approved;
 * "synthetic" rows are generated. With --train-only the rows skip the val/test split and always train, so
 * val and test stay as they were when a model was last scored. --split pins every row to a split
 * (--train-only is the same as --split train); `# split:` and `# pattern:` lines in the batch tag rows
 * individually and win over the flags. A message already in the file is skipped.
 * Existing rows, and any review already done on them, are never touched.
 */
import { readFile, writeFile } from "node:fs/promises";

import { parseBatch, validateBatch } from "../src/lib/sft/batch";
import type { Version } from "../src/lib/sft/build";
import type { Split } from "../src/lib/sft/split";
import { addExamples, parseExamples, serializeExamples, type ExampleSource } from "../src/lib/sft/examples";

const args = process.argv.slice(2);
const flag = args.indexOf("--source");
const source = (flag === -1 ? "synthetic" : args[flag + 1]) as ExampleSource;
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const trainOnly = args.includes("--train-only");
const split = value("--split") as Split | undefined;
const pattern = value("--pattern");
const version = value("--version") as Version | undefined;
const valued = ["--source", "--split", "--pattern", "--version"];
const batchPath = args.find((arg, index) => !arg.startsWith("--") && !valued.includes(args[index - 1] ?? ""));
if (!batchPath || (source !== "sample" && source !== "synthetic") || (split && !["train", "val", "test"].includes(split)) || (version && !["v1", "v2", "v3"].includes(version))) {
  console.error("Usage: npm run sft:add -- path/to/batch.txt [--source sample|synthetic] [--split train|val|test] [--pattern name] [--version v1|v2|v3] [--train-only]");
  process.exit(1);
}
const FILE = "data/sft/examples.jsonl";

const batch = parseBatch(await readFile(batchPath, "utf8"));
const problems = validateBatch(batch);
if (problems.length > 0) {
  console.error(`${problems.length} problem(s) in ${batchPath}:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

const existing = parseExamples(await readFile(FILE, "utf8").catch(() => ""));
const { records, skipped } = addExamples(existing, batch, source, { trainOnly, split, pattern, version });
await writeFile(FILE, serializeExamples(records));

console.log(`Added ${records.length - existing.length} pending ${source} row(s); skipped ${skipped.length}.`);
for (const { message, reason } of skipped) console.log(`  skipped "${message}": ${reason}`);
