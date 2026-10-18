/**
 * Score Jev and Laya on the same held-out messages: action accuracy and CPU latency.
 *
 *   npm run compare -- [jsonl-file] [count]
 *
 * Defaults to data/sft/test.jsonl (the action label is meta.action). Needs TYPESAFE_API_KEY for Jev and the
 * Laya server running (scripts/laya/server.py). Each message goes to both, one at a time. The first two
 * messages are warm-up and are left out of the latency numbers (but still count for accuracy).
 */
import { readFile } from "node:fs/promises";

import { askJev, classify } from "../src/lib/jev/classify";
import { askLaya } from "../src/lib/jev/laya";

const [path = "data/sft/test.jsonl", countArg = "1000"] = process.argv.slice(2);
const WARMUP = 2;

type Row = { messages: { role: string; content: string }[]; meta: { action: string | null } };
const rows = (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Row);
const cases = rows
  .map((row) => ({ message: row.messages.find((m) => m.role === "user")?.content ?? "", expected: row.meta.action }))
  .filter((c) => c.message)
  .slice(0, Number(countArg));

const backends = { Jev: askJev, Laya: askLaya } as const;
const stats = Object.fromEntries(Object.keys(backends).map((name) => [name, { right: 0, times: [] as number[], wrong: [] as string[] }]));

for (const [i, { message, expected }] of cases.entries()) {
  for (const [name, ask] of Object.entries(backends)) {
    const start = performance.now();
    const result = await classify(message, ask);
    const ms = performance.now() - start;
    const s = stats[name]!;
    if (i >= WARMUP) s.times.push(ms);
    if (result.action === expected) s.right++;
    else s.wrong.push(`${expected} -> ${result.action}: ${message}`);
  }
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
console.log(`Messages: ${cases.length} from ${path}\n`);
console.log(`| Classifier | Action accuracy | Median latency | 95th percentile | Mean |`);
console.log(`| --- | --- | --- | --- | --- |`);
for (const [name, s] of Object.entries(stats)) {
  const sorted = [...s.times].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  console.log(`| ${name} | ${((100 * s.right) / cases.length).toFixed(1)}% (${s.right}/${cases.length}) | ${(pct(sorted, 50) / 1000).toFixed(2)} s | ${(pct(sorted, 95) / 1000).toFixed(2)} s | ${(mean / 1000).toFixed(2)} s |`);
}
for (const [name, s] of Object.entries(stats)) console.log(`\n${name} mistakes (${s.wrong.length}):\n${s.wrong.slice(0, 15).join("\n")}`);
