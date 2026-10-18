/**
 * Build the action-picking files for the "extractor picks the action too" experiment (docs/sft-action.md).
 *
 *   npx tsx scripts/sft-actions.mts            write data/sft/action/{train,val,test}.jsonl
 *
 * Every row of data/sft/{train,val,test}.jsonl becomes (system prompt, message) -> {"action": "<action>"}, in the same
 * split, so nothing leaks. manage_card, view_account and "none" have no free-text fields and so no rows there: their
 * train and val rows come from data/sft/action-extra.txt, and their test rows from data/sample-messages.txt.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { CATALOG } from "../src/lib/jev/catalog";
import { actionPrompt } from "../src/lib/extract/prompt";

type Row = { messages: [object, object, object]; meta: { id: string; action: string; source: string } };
const record = (id: string, action: string, message: string, source: string): Row => ({
  messages: [
    { role: "system", content: actionPrompt() },
    { role: "user", content: message },
    { role: "assistant", content: JSON.stringify({ action }) },
  ],
  meta: { id, action, source },
});

const out: Record<"train" | "val" | "test", Row[]> = { train: [], val: [], test: [] };

for (const split of ["train", "val", "test"] as const) {
  const text = await readFile(`data/sft/${split}.jsonl`, "utf8");
  for (const line of text.split("\n").filter(Boolean)) {
    const old = JSON.parse(line);
    out[split].push(record(old.meta.id, old.meta.action, old.messages[1].content, old.meta.source ?? "synthetic"));
  }
}

const sections = (text: string, header: (line: string) => [string, string] | null) => {
  const rows: [string, string, string][] = [];
  let current: [string, string] | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) current = header(line);
    else if (current) rows.push([current[0], current[1], line]);
  }
  return rows;
};

const extra = await readFile("data/sft/action-extra.txt", "utf8");
const counters: Record<string, number> = {};
for (const [split, action, message] of sections(extra, (l) => {
  const m = /^# (train|val) (\w+)$/.exec(l);
  return m ? [m[1]!, m[2]!] : null;
})) {
  const key = `${split}-${action}`;
  counters[key] = (counters[key] ?? 0) + 1;
  out[split as "train" | "val"].push(record(`act-${key}-${counters[key]}`, action, message, "extra"));
}

const NEW = new Set(["manage_card", "view_account", "none"]);
const sample = await readFile("data/sample-messages.txt", "utf8");
let n = 0;
for (const [, action, message] of sections(sample, (l) => {
  const name = l.replace(/^# (ambiguous: )?/, "");
  if (name === "no action") return ["test", "none"];
  return NEW.has(name) ? ["test", name] : null;
})) out.test.push(record(`act-sample-${++n}`, action, message, "sample"));

const known = new Set([...Object.keys(CATALOG), "none"]);
for (const rows of Object.values(out)) for (const r of rows) if (!known.has(r.meta.action)) throw new Error(`unknown action ${r.meta.action}`);

// A message must not sit in two splits: where one does, the test copy stays and the other is dropped (v5 already has a few).
const norm = (r: Row) => (r.messages[1] as { content: string }).content.trim().toLowerCase();
const testTexts = new Set(out.test.map(norm));
const valTexts = new Set(out.val.map(norm));
for (const [split, rows] of [["train", out.train], ["val", out.val]] as const) {
  const before = rows.length;
  out[split] = rows.filter((r) => !testTexts.has(norm(r)) && (split === "val" || !valTexts.has(norm(r))));
  if (out[split].length < before) console.warn(`dropped ${before - out[split].length} ${split} row(s) that repeat a later split`);
}

// The combined set: the extraction records and the action records in one file per split, to train one model on both.
await mkdir("data/sft/combined", { recursive: true });
for (const split of ["train", "val", "test"] as const) {
  const extraction = (await readFile(`data/sft/${split}.jsonl`, "utf8")).split("\n").filter(Boolean);
  await writeFile(`data/sft/combined/${split}.jsonl`, [...extraction, ...out[split].map((r) => JSON.stringify(r))].join("\n") + "\n");
}

await mkdir("data/sft/action", { recursive: true });
for (const [split, rows] of Object.entries(out)) {
  await writeFile(`data/sft/action/${split}.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.meta.action] = (counts[r.meta.action] ?? 0) + 1;
  console.log(split.padEnd(6), String(rows.length).padStart(5), JSON.stringify(counts));
}
