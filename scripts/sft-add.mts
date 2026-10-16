/**
 * Add labeled messages to data/sft/examples.jsonl as pending rows, ready to review on /annotate.
 *
 *   npm run sft:add -- path/to/batch.txt [--source sample|synthetic]    (default: synthetic)
 *
 * The batch is plain text, one example per line: `message => field=value; field=value`, with
 * `# <action>` headers. "sample" rows are real messages that can end up in val or test once approved;
 * "synthetic" rows are generated and only ever train. A message already in the file is skipped.
 * Existing rows, and any review already done on them, are never touched.
 */
import { readFile, writeFile } from "node:fs/promises";

import { parseBatch, validateBatch } from "../src/lib/sft/batch";
import { addExamples, parseExamples, serializeExamples, type ExampleSource } from "../src/lib/sft/examples";

const args = process.argv.slice(2);
const flag = args.indexOf("--source");
const source = (flag === -1 ? "synthetic" : args[flag + 1]) as ExampleSource;
const batchPath = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--source");
if (!batchPath || (source !== "sample" && source !== "synthetic")) {
  console.error("Usage: npm run sft:add -- path/to/batch.txt [--source sample|synthetic]");
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
const { records, skipped } = addExamples(existing, batch, source);
await writeFile(FILE, serializeExamples(records));

console.log(`Added ${records.length - existing.length} pending ${source} row(s); skipped ${skipped.length}.`);
for (const { message, reason } of skipped) console.log(`  skipped "${message}": ${reason}`);
