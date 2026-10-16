/**
 * Run the sample messages through the local Ollama extractor and write a CSV, one row per field.
 *
 *   npm run extract:eval -- [messages-file] [output-csv]
 *
 * Needs a running Ollama with the model from scripts/ollama/setup.sh. Groups in the messages file
 * named after an action (or "ambiguous: <action>") are asked for that action's fields; other
 * groups (mixed, no action, tricky values) have no single action and are skipped.
 * `status` says what happened: kept, blank (message doesn't say) or dropped (model made it up).
 */
import { readFile, writeFile } from "node:fs/promises";

import { CATALOG } from "../src/lib/jev/catalog";
import { extractFields } from "../src/lib/extract/ollama";

const [inputPath = "data/sample-messages.txt", outputPath = "extractions.csv"] = process.argv.slice(2);

const csvCell = (value: string | number | null) => {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const rows = [["group", "action", "message", "field", "raw_model_value", "value", "status", "latency_s"]];
let group = "";
let messages = 0;
for (const raw of (await readFile(inputPath, "utf8")).split("\n")) {
  const line = raw.trim();
  if (!line) continue;
  if (line.startsWith("#")) {
    group = line.replace(/^#\s*/, "");
    continue;
  }
  const action = group.replace(/^ambiguous:\s*/, "");
  if (!(action in CATALOG)) continue;
  const started = performance.now();
  const fields = await extractFields(action as keyof typeof CATALOG, line);
  const seconds = ((performance.now() - started) / 1000).toFixed(2);
  messages++;
  for (const [name, field] of Object.entries(fields)) {
    rows.push([group, action, line, name, field.raw, field.value, field.status, seconds].map(csvCell));
  }
}
await writeFile(outputPath, rows.map((r) => r.join(",")).join("\n") + "\n");
console.log(`Wrote ${outputPath}: ${messages} messages`);
