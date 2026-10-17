/**
 * Stress-test the local extractor on data/extract-stress.txt (lines of `message => field=value; ...`, `#` headers name
 * `category | action`). Prints exact-record pass rate per category and writes every result to the JSON path.
 *
 *   OLLAMA_MODEL=lfm25-230m-sft npx tsx --conditions=react-server scripts/extract-stress.mts data/extract-stress.txt out.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { CATALOG } from "../src/lib/jev/catalog";
import { extractFields } from "../src/lib/extract/ollama";

const [casesPath = "data/extract-stress.txt", outPath = "extract-stress.json"] = process.argv.slice(2);
type Row = { category: string; action: string; message: string; expected: Record<string, string>; got: Record<string, string>; fabricated: string[]; missed: string[]; wrong: string[]; exact: boolean };
const rows: Row[] = [];
let category = "", action = "";
for (const raw of (await readFile(casesPath, "utf8")).split("\n")) {
  const line = raw.replace(/\r$/, "");
  if (!line.trim()) continue;
  if (line.startsWith("#")) {
    const [c, a] = line.replace(/^#\s*/, "").split("|").map((s) => s.trim());
    category = c ?? ""; action = a ?? c ?? "";
    continue;
  }
  const [msgRaw = "", exp = ""] = line.split(" =>");
  const message = msgRaw.replaceAll("\\n", "\n").replaceAll("\\t", "\t");
  const expected: Record<string, string> = {};
  for (const part of exp.split(";")) { const i = part.indexOf("="); if (i > 0) expected[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  const fields = await extractFields(action as keyof typeof CATALOG, message);
  const got: Record<string, string> = {};
  for (const [n, f] of Object.entries(fields)) got[n] = f.value === null ? "" : String(f.value);
  const isAmount = (n: string) => n === "amount" || n === "initial_deposit";
  const same = (n: string, a: string, b: string) => a === b || (isAmount(n) && a !== "" && b !== "" && !isNaN(Number(a)) && !isNaN(Number(b)) && Number(a) === Number(b));
  const fabricated: string[] = [], missed: string[] = [], wrong: string[] = [];
  for (const n of Object.keys(got)) {
    const e = expected[n] ?? "", g = got[n] ?? "";
    if (same(n, e, g)) continue;
    if (e === "") fabricated.push(n); else if (g === "") missed.push(n); else wrong.push(n);
  }
  rows.push({ category, action, message, expected, got, fabricated, missed, wrong, exact: !fabricated.length && !missed.length && !wrong.length });
}
await writeFile(outPath, JSON.stringify(rows, null, 1));
const by: Record<string, [number, number]> = {};
for (const r of rows) {
  const tally = (by[r.category] ??= [0, 0]);
  tally[1]++;
  if (r.exact) tally[0]++;
}
console.log(`exact ${rows.filter((r) => r.exact).length}/${rows.length}`);
for (const [c, [p, t]] of Object.entries(by)) console.log(`${c}: ${p}/${t}`);
