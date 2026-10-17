/**
 * Time Jev, the extractor and the two together over the sample messages, one message at a time.
 *
 *   npm run latency -- [messages-file] [count]
 *
 * Needs TYPESAFE_API_KEY in the environment and Ollama running. The first two messages are warm-up
 * (model load, connection setup) and are left out of the numbers. "Overall" is what the chat's server
 * action does: Jev first, then the extractor on the action Jev picked. Messages Jev maps to no action skip
 * the extractor, so they count in Jev and Overall but not in Extractor.
 */
import { readFile } from "node:fs/promises";

import { classify } from "../src/lib/jev/classify";
import { withExtractedFields } from "../src/lib/extract/apply";

const [inputPath = "data/sample-messages.txt", countArg = "60"] = process.argv.slice(2);
const WARMUP = 2;

const messages = (await readFile(inputPath, "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
// Spread the picks over the whole file so every action group is represented.
const count = Math.min(Number(countArg), messages.length);
const picked = Array.from({ length: count + WARMUP }, (_, i) => messages[Math.floor((i * messages.length) / (count + WARMUP))] ?? "");

const jev: number[] = [];
const extractor: number[] = [];
const overall: number[] = [];

for (const [i, message] of picked.entries()) {
  const start = performance.now();
  const result = await classify(message);
  const afterJev = performance.now();
  await withExtractedFields(result, message);
  const end = performance.now();
  if (i < WARMUP) continue;
  jev.push(afterJev - start);
  overall.push(end - start);
  if (result.action) extractor.push(end - afterJev);
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const seconds = (ms: number) => (ms / 1000).toFixed(2);
console.log(`| Step | Messages | Median | 95th percentile | Mean |`);
console.log(`| --- | --- | --- | --- | --- |`);
for (const [name, values] of [["Jev (TypeSafe API)", jev], ["Fine-tuned extractor (Ollama)", extractor], ["Overall (Jev, then extractor)", overall]] as const) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  console.log(`| ${name} | ${sorted.length} | ${seconds(percentile(sorted, 50))} s | ${seconds(percentile(sorted, 95))} s | ${seconds(mean)} s |`);
}
