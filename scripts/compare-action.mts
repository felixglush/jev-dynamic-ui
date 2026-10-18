/**
 * Run Jev's action question over the action test file and write what it picked (docs/sft-action.md).
 *
 *   npx tsx --conditions react-server scripts/compare-action.mts [out.json]
 *
 * Needs TYPESAFE_API_KEY. One Jev request per message (about 500), so it spends credits.
 */
import { readFile, writeFile } from "node:fs/promises";

import { classify } from "../src/lib/jev/classify";

const outPath = process.argv[2] ?? "training/out/jev-action-test.json";
const rows = (await readFile("data/sft/action/test.jsonl", "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const results: { id: string; message: string; expected: string; jev: string; confidence: number | null; ms: number }[] = [];

let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < rows.length) {
      const row = rows[next++];
      const message = row.messages[1].content as string;
      const start = performance.now();
      try {
        const r = await classify(message);
        results.push({ id: row.meta.id, message, expected: row.meta.action, jev: r.action ?? "none", confidence: r.confidence ?? null, ms: Math.round(performance.now() - start) });
      } catch (error) {
        results.push({ id: row.meta.id, message, expected: row.meta.action, jev: `error: ${error instanceof Error ? error.message : error}`, confidence: null, ms: 0 });
      }
    }
  }),
);
results.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(outPath, JSON.stringify(results, null, 1));
console.log(`${results.filter((r) => r.jev === r.expected).length}/${results.length} correct, ${results.filter((r) => r.jev.startsWith("error")).length} errors`);
