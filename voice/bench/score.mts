/**
 * Scores speech-to-text results on the same 20 clips in a way that fits this app, so engines that write digits
 * (Whisper, LFM2.5-Audio) and engines that write words (the streaming Zipformer) can be compared fairly.
 *
 *   node voice/bench/score.mts voice/bench/whisper-results.json voice/bench/qwen-results.json ...
 *
 * Every transcript first goes through `normalizeSpoken`, the same clean-up the app applies before Jev and the
 * extractor. Then it is compared with the written form in clips.jsonl:
 *   - WER      word error rate against the written form (lower is better).
 *   - Entities share of the values the extractor needs (amounts, names, emails, phone and account numbers,
 *              key words) found in the transcript (higher is better). `entities` in clips.jsonl lists
 *              alternatives that count as the same value.
 *   - Exact    clips where every entity was found.
 * Add `--misses` to list, per engine, each clip and the values that were not found.
 * Each results file is an object of `{ name: { hyps: [...], median_s?, max_s? } }`, or one such object with `hyps` at
 * the top (stream-results.json). Prints a Markdown table to paste into docs/voice-benchmarks.md.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { normalizeSpoken } from "../../src/lib/stt/normalize.ts";

type Clip = { id: number; spoken: string; written: string; entities: string[][] };
type Run = { hyps: string[]; median_s?: number; max_s?: number; after_stop_median_s?: number; after_stop_max_s?: number };

const dir = new URL(".", import.meta.url).pathname;
const clips: Clip[] = readFileSync(`${dir}clips.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line));

/** Lowercase words, no currency signs or thousands commas, hyphens as spaces, outer punctuation trimmed. */
const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[$,]/g, "")
    .replace(/-/g, " ")
    .replace(/[^a-z0-9@._+ ]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);

function wordErrors(ref: string[], hyp: string[]): number {
  const row = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= hyp.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[hyp.length]!;
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

const rows: string[] = [];
const showMisses = process.argv.includes("--misses");
const misses: string[] = [];
for (const file of process.argv.slice(2).filter((arg) => !arg.startsWith("--"))) {
  const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, Run> | Run;
  const runs: [string, Run][] = "hyps" in data ? [[basename(file, ".json"), data]] : Object.entries(data);
  for (const [name, run] of runs) {
    let errors = 0, words = 0, found = 0, total = 0, exact = 0;
    clips.forEach((clip, i) => {
      const hyp = norm(normalizeSpoken(run.hyps[i] ?? ""));
      const ref = norm(clip.written);
      errors += wordErrors(ref, hyp);
      words += ref.length;
      const text = ` ${hyp.join(" ")} `;
      const hits = clip.entities.filter((alternatives) => alternatives.some((alt) => text.includes(` ${norm(alt).join(" ")} `))).length;
      if (showMisses && hits < clip.entities.length) {
        const missing = clip.entities.filter((alternatives) => !alternatives.some((alt) => text.includes(` ${norm(alt).join(" ")} `)));
        misses.push(`${name} #${clip.id}: missing ${missing.map((a) => a[0]).join(", ")} in "${hyp.join(" ")}"`);
      }
      found += hits;
      total += clip.entities.length;
      if (hits === clip.entities.length) exact++;
    });
    const med = run.median_s ?? run.after_stop_median_s;
    const max = run.max_s ?? run.after_stop_max_s;
    const time = med === undefined ? "n/a" : `${med.toFixed(2)} s / ${max?.toFixed(2)} s`;
    rows.push(`| ${name} | ${pct(errors / words)} | ${pct(found / total)} (${found}/${total}) | ${exact}/${clips.length} | ${time} |`);
  }
}
console.log("| Engine | WER (written) | Entities found | Clips fully right | Time per clip (median / max) |");
console.log("| --- | --- | --- | --- | --- |");
console.log(rows.join("\n"));
if (misses.length > 0) console.log(`\n${misses.join("\n")}`);
