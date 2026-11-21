/**
 * Score Jev's action choice on labeled messages: accuracy, precision and recall per action, and what gets mixed up.
 *
 *   npm run action:eval -- [sft-jsonl, default data/sft/test.jsonl] [limit]
 *
 * Needs TYPESAFE_API_KEY. Each record's expected action is its `meta.action`. Only Jev is called (no extractor).
 * The sft test rows are AI-written, so this is a first read; real messages from /annotate are the better check.
 */
import { readFile } from "node:fs/promises";

import { scoreActions, type ActionPair } from "../src/lib/annotate/action-scores";
import { classify } from "../src/lib/jev/classify";

const [inputPath = "data/sft/test.jsonl", limitArg] = process.argv.slice(2);
const CONCURRENCY = 4;

type Row = { message: string; expected: string };
const rows: Row[] = (await readFile(inputPath, "utf8"))
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => {
    const record = JSON.parse(line);
    return { message: record.messages.find((m: { role: string }) => m.role === "user").content, expected: record.meta.action };
  })
  .slice(0, limitArg ? Number(limitArg) : undefined);

const pairs = new Array<ActionPair | null>(rows.length).fill(null);
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < rows.length) {
      const index = next++;
      const row = rows[index]!;
      try {
        pairs[index] = { expected: row.expected, predicted: (await classify(row.message)).action ?? "none" };
      } catch (error) {
        console.error(`Skipped "${row.message}": ${error instanceof Error ? error.message : error}`);
      }
    }
  }),
);

const scored = pairs.filter((p): p is ActionPair => p !== null);
const result = scoreActions(scored);
const pct = (v: number | null) => (v === null ? "  –  " : `${(v * 100).toFixed(1).padStart(5)}%`);
console.log(`Action accuracy: ${result.correct} of ${result.total} (${pct(result.accuracy).trim()})${scored.length < rows.length ? `, ${rows.length - scored.length} failed calls left out` : ""}\n`);
console.log("action".padEnd(28), "rows".padStart(5), "precision".padStart(10), "recall".padStart(8));
for (const r of result.perAction) console.log(r.action.padEnd(28), String(r.expected).padStart(5), pct(r.precision).padStart(10), pct(r.recall).padStart(8));
if (result.confusions.length) {
  console.log("\nMost often mixed up (expected → picked):");
  for (const c of result.confusions.slice(0, 10)) console.log(`  ${c.expected} → ${c.predicted}: ${c.count}`);
}
