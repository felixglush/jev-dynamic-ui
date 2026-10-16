/**
 * Add generated examples to the synthetic file as pending rows, ready to review on /annotate.
 *
 *   npm run sft:add -- path/to/batch.txt
 *
 * The batch uses the seed file's format (`message => field=value; field=value`, `# <action>` headers).
 * A message already in the seed set or the synthetic file is skipped. Existing rows, and any review
 * already done on them, are never touched; new rows get the next syn-NNNN ids.
 */
import { readFile, writeFile } from "node:fs/promises";

import { parseSeed, validateExamples } from "../src/lib/sft/seed";
import { addExamples, messageKey, parseSynthetic, serializeSynthetic } from "../src/lib/sft/synthetic";

const [batchPath] = process.argv.slice(2);
if (!batchPath) {
  console.error("Usage: npm run sft:add -- path/to/batch.txt");
  process.exit(1);
}
const SYNTHETIC = "data/sft/synthetic.jsonl";

const batch = parseSeed(await readFile(batchPath, "utf8"));
const problems = validateExamples(batch);
if (problems.length > 0) {
  console.error(`${problems.length} problem(s) in ${batchPath}:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

const seed = parseSeed(await readFile("data/sft/seed-labeled.txt", "utf8"));
const existing = parseSynthetic(await readFile(SYNTHETIC, "utf8").catch(() => ""));
const { records, skipped } = addExamples(existing, batch, new Set(seed.map((e) => messageKey(e.action, e.message))));
await writeFile(SYNTHETIC, serializeSynthetic(records));

console.log(`Added ${records.length - existing.length} pending row(s); skipped ${skipped.length}.`);
for (const { message, reason } of skipped) console.log(`  skipped "${message}": ${reason}`);
