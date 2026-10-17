/**
 * Run the sample messages through the local Ollama extractor and write a CSV, one row per field.
 *
 *   npm run extract:eval -- [messages-file] [output-csv]
 *
 * Needs a running Ollama with the model from scripts/ollama/setup.sh. Groups in the messages file
 * named after an action (or "ambiguous: <action>") are asked for that action's fields; other
 * groups (mixed, no action, tricky values) have no single action and are skipped.
 * Give an output path ending in .jsonl to get the fine-tuning record format instead (the model's answer as
 * the assistant message), which the /annotate page can import to review just the model's fields.
 * `status` says what happened: kept (the model gave a value) or blank (it left the field empty).
 */
import { readFile, writeFile } from "node:fs/promises";

import { CATALOG } from "../src/lib/jev/catalog";
import { extractFields, systemPromptFor } from "../src/lib/extract/ollama";

const [inputPath = "data/sample-messages.txt", outputPath = "extractions.csv"] = process.argv.slice(2);

const csvCell = (value: string | number | null) => {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const asJsonl = outputPath.endsWith(".jsonl");
const records: string[] = [];
const rows = [["group", "action", "message", "field", "value", "status", "latency_s"]];
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
  records.push(
    JSON.stringify({
      messages: [
        { role: "system", content: systemPromptFor(action as keyof typeof CATALOG) },
        { role: "user", content: line },
        {
          role: "assistant",
          // A blank field is "" here; the review page reads "" and 0 alike as blank.
          content: JSON.stringify(Object.fromEntries(Object.entries(fields).map(([n, f]) => [n, f.value ?? ""]))),
        },
      ],
      meta: { id: `model-${String(messages).padStart(3, "0")}`, action, vague: group.startsWith("ambiguous"), present: Object.entries(fields).filter(([, f]) => f.value !== null).map(([n]) => n), source: "model" },
    }),
  );
  for (const [name, field] of Object.entries(fields)) {
    rows.push([group, action, line, name, field.value, field.status, seconds].map(csvCell));
  }
}
await writeFile(outputPath, asJsonl ? records.join("\n") + "\n" : rows.map((r) => r.join(",")).join("\n") + "\n");
console.log(`Wrote ${outputPath}: ${messages} messages`);
