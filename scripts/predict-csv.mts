/** Helpers shared by the scripts that write predictions.csv. */
import type { ClassifyResult } from "../src/lib/jev/types";

export const HEADER = ["id", "group", "message", "predicted_action", "action_confidence", "params", "missing_required", "expected_action", "note"];

export function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Split CSV text into rows of cells (quotes, doubled quotes and newlines inside quotes are handled). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function describe(result: ClassifyResult | Error) {
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
  return { action: result.action, confidence: result.confidence.toFixed(3), params, missing: result.missing.join("; "), note: "" };
}
