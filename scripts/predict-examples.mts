/**
 * Run Jev on every message in the fine-tuning examples file that predictions.csv does not cover yet,
 * so the Predictions tab holds the whole dataset.
 *
 *   npm run predict:examples -- [--limit N] [--file predictions.csv]
 *
 * Needs TYPESAFE_API_KEY. Safe to stop and re-run: finished rows are kept (their ids too, so saved
 * answers stay attached), rows that errored are tried again, and only messages not in the file are sent.
 * New rows take the example's id and its action as the group.
 */
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";

import { classify } from "../src/lib/jev/classify";
import { withExtractedFields } from "../src/lib/extract/apply";
import { normalizeMessage, parseExamples } from "../src/lib/sft/examples";
import { csvCell, describe, HEADER, parseCsv } from "../src/lib/annotate/predictions-csv";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const limit = flag("--limit") ? Number(flag("--limit")) : Infinity;
const file = flag("--file") ?? "predictions.csv";
const CONCURRENCY = 4;

const kept = existsSync(file) ? parseCsv(await readFile(file, "utf8")).slice(1).filter((row) => row.length >= 4 && row[3] !== "ERROR") : [];
const have = new Set(kept.map((row) => normalizeMessage(row[2]!)));

const todo: { id: string; group: string; message: string }[] = [];
for (const record of parseExamples(await readFile("data/sft/examples.jsonl", "utf8"))) {
  const message = record.messages[1].content;
  const key = normalizeMessage(message);
  if (have.has(key)) continue;
  have.add(key);
  todo.push({ id: record.meta.id, group: record.meta.action, message });
}
const batch = todo.slice(0, limit);
console.log(`${kept.length} predictions kept, ${todo.length} messages to run${batch.length < todo.length ? ` (running ${batch.length})` : ""}`);

const rows = [...kept];
const save = async () => {
  await writeFile(`${file}.tmp`, [HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n");
  await rename(`${file}.tmp`, file);
};

const started = Date.now();
let next = 0;
let errors = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < batch.length) {
      const item = batch[next++]!;
      let result;
      try {
        result = (await withExtractedFields(await classify(item.message), item.message)).result;
      } catch (error) {
        result = error instanceof Error ? error : new Error(String(error));
        errors++;
      }
      const d = describe(result);
      rows.push([item.id, item.group, item.message, d.action, d.confidence, d.params, d.missing, "", d.note]);
      if (rows.length % 25 === 0) {
        await save();
        console.log(`${rows.length - kept.length}/${batch.length} done, ${Math.round((Date.now() - started) / 1000)}s`);
      }
    }
  }),
);
await save();
console.log(`Wrote ${rows.length} predictions to ${file} in ${Math.round((Date.now() - started) / 1000)}s (${errors} errors; re-run to retry them)`);
if (errors) process.exitCode = 1;
