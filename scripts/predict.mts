/**
 * Run messages through the real classifier and write a CSV of Jev's predictions to validate.
 *
 *   npm run predict -- [messages-file] [output-csv]
 *
 * Needs TYPESAFE_API_KEY in the environment. The `expected_action` column is left empty for you
 * to fill in, then compare it with `predicted_action` in a spreadsheet.
 */
import { readFile, writeFile } from "node:fs/promises";

import { classify } from "../src/lib/jev/classify";
import type { ClassifyResult } from "../src/lib/jev/types";

const [inputPath = "data/sample-messages.txt", outputPath = "predictions.csv"] = process.argv.slice(2);
const CONCURRENCY = 4;

type Item = { id: number; group: string; message: string };

/** Lines starting with `#` set the group label; other non-empty lines are messages. */
function parseMessages(text: string): Item[] {
  const items: Item[] = [];
  let group = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      group = line.replace(/^#\s*/, "");
      continue;
    }
    items.push({ id: items.length + 1, group, message: line });
  }
  return items;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function describe(result: ClassifyResult | Error) {
  if (result instanceof Error) {
    return { action: "ERROR", confidence: "", params: "", missing: "", note: result.message };
  }
  if (result.action === null) {
    return { action: "none", confidence: result.confidence.toFixed(3), params: "", missing: "", note: "" };
  }
  // result.params has a different shape per action, so view it generically for printing.
  const params = Object.entries(result.params as Record<string, { value: string | null; confidence: number | null }>)
    .filter(([, p]) => p.value !== null)
    .map(([name, p]) => `${name}=${p.value}${p.confidence === null ? "" : ` (${p.confidence.toFixed(2)})`}`)
    .join("; ");
  return {
    action: result.action,
    confidence: result.confidence.toFixed(3),
    params,
    missing: result.missing.join("; "),
    note: "",
  };
}

const items = parseMessages(await readFile(inputPath, "utf8"));
const results = new Array<ClassifyResult | Error>(items.length);

// A tiny worker pool: each worker keeps taking the next unprocessed message.
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (!item) break;
      try {
        results[index] = await classify(item.message);
      } catch (error) {
        results[index] = error instanceof Error ? error : new Error(String(error));
      }
    }
  }),
);

const header = ["id", "group", "message", "predicted_action", "action_confidence", "params", "missing_required", "expected_action", "note"];
const rows = items.map((item, i) => {
  const d = describe(results[i] ?? new Error("No result"));
  return [item.id, item.group, item.message, d.action, d.confidence, d.params, d.missing, "", d.note];
});
await writeFile(outputPath, [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n");

const failed = results.filter((r) => r instanceof Error).length;
console.log(`Wrote ${rows.length} predictions to ${outputPath}${failed ? ` (${failed} errors, see the note column)` : ""}`);
if (failed) process.exitCode = 1;
