/**
 * Every labeled example and its review state, kept in one JSONL file (data/sft/examples.jsonl). Same
 * record format as the other SFT files, plus review fields in `meta`:
 *
 *   source    "sample" (the first batch, from data/sample-messages.txt) or
 *             "synthetic" (generated later). Both are AI-written and treated the same
 *   status    "pending" (not looked at), "approved" (goes into training) or "rejected" (never used)
 *   original  what the generator wrote, kept once a reviewer changes it, so the page can show the
 *             correction and "undo" can restore it
 *   note      the reviewer's note
 *   split     pins the row to "train", "val" or "test", overriding the hash split (split.ts). Rows added after
 *             a model was scored use it, so the other rows keep their splits and runs stay comparable
 *   trainOnly older spelling of `split: "train"`; still honoured
 *   pattern   the failure pattern the row probes (e.g. "spelled-amount"); training/modal_train.py reports
 *             pass rate per pattern on val and test
 *   version   which evaluation set the row was added for: "v1" (the default when absent), "v2", "v3" or "v4".
 *             Scores are only compared within one version (docs/sft-experiments.md, "Fair evaluation v2")
 *   retired   the first version that no longer contains the row (a bad example); older versions keep it
 *
 * Labels were written by Claude, so nothing counts until a person approves it on /annotate, which edits
 * this file in place. `npm run sft:build` then builds train, val and test from the approved rows.
 */
import { CATALOG } from "@/lib/jev/catalog";
import { freeTextParams, systemPromptFor } from "@/lib/extract/prompt";
import { toRecord, type SftRecord } from "./record";
import type { Action, LabeledExample } from "./batch";
import type { Split } from "./split";
import type { Version } from "./build";

export type ExampleSource = "sample" | "synthetic";
export type ReviewStatus = "pending" | "approved" | "rejected";

export type ExampleRecord = SftRecord & {
  meta: SftRecord["meta"] & { source: ExampleSource; status: ReviewStatus; original?: { action: string; answer: string }; note?: string; trainOnly?: boolean; split?: Split; pattern?: string; version?: Version; retired?: Version };
};

/** What a reviewer decided: an action ("none" rejects the row) and the values, as the annotate form gives them. */
export type Review = { expectedAction: string; expectedParams: Record<string, string>; note?: string };

export const normalizeMessage = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
export const messageKey = (action: string, message: string) => `${action}|${normalizeMessage(message)}`;

export function parseExamples(text: string): ExampleRecord[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      const record = JSON.parse(line) as ExampleRecord;
      if (record.meta?.source !== "sample" && record.meta?.source !== "synthetic") throw new Error(`Line ${index + 1}: not an example record.`);
      return record;
    });
}

export const serializeExamples = (records: ExampleRecord[]) => records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");

const ID_PREFIX: Record<ExampleSource, string> = { sample: "smp", synthetic: "syn" };

/**
 * Append new examples as pending rows with the next ids for their source. Messages that are already
 * in the file (same action) are skipped and reported. Sample rows are kept ahead of synthetic ones,
 * so they come first in the review; existing rows are never changed.
 */
export function addExamples(
  records: ExampleRecord[],
  examples: LabeledExample[],
  source: ExampleSource,
  options: { trainOnly?: boolean; split?: Split; pattern?: string; version?: Version } = {},
): { records: ExampleRecord[]; skipped: { message: string; reason: string }[] } {
  const keys = new Set(records.map((r) => messageKey(r.meta.action, r.messages[1].content)));
  let next = records.filter((r) => r.meta.source === source).reduce((max, r) => Math.max(max, Number(r.meta.id.replace(/\D/g, "")) || 0), 0) + 1;
  const added: ExampleRecord[] = [];
  const skipped: { message: string; reason: string }[] = [];
  for (const example of examples) {
    const key = messageKey(example.action, example.message);
    if (keys.has(key)) {
      skipped.push({ message: example.message, reason: "already in the file" });
      continue;
    }
    keys.add(key);
    const record = toRecord({ ...example, id: `${ID_PREFIX[source]}-${String(next++).padStart(source === "sample" ? 3 : 4, "0")}` });
    // Tags set in the batch file (`# pattern:` / `# split:`) win over the command-line defaults.
    const tags = {
      ...((example.split ?? options.split) ? { split: (example.split ?? options.split)! } : {}),
      ...((example.pattern ?? options.pattern) ? { pattern: (example.pattern ?? options.pattern)! } : {}),
      ...(options.version ? { version: options.version } : {}),
    };
    added.push({
      ...record,
      meta: {
        ...record.meta,
        source,
        status: "pending",
        ...(options.trainOnly ? { trainOnly: true } : {}),
        ...tags,
      },
    });
  }
  const all = [...records, ...added];
  return { records: [...all.filter((r) => r.meta.source === "sample"), ...all.filter((r) => r.meta.source === "synthetic")], skipped };
}

/** The review form's values for the action's free-text fields, as a labeled example. Throws on a bad amount. */
function exampleFrom(record: ExampleRecord, action: Action, params: Record<string, string>): LabeledExample {
  const fields: Record<string, string | number> = {};
  for (const [name, spec] of freeTextParams(action)) {
    const text = (params[name] ?? "").trim();
    if (!text) continue;
    if (spec.type === "amount") {
      const amount = Number(text.replaceAll(/[$,\s]/g, ""));
      if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${record.meta.id}: "${text}" isn't an amount.`);
      fields[name] = amount;
    } else {
      fields[name] = text;
    }
  }
  return { id: record.meta.id, action, message: record.messages[1].content, fields, vague: record.meta.vague };
}

/** Apply one review to a row. `null` takes the review back: the row goes to pending with the generator's answer. */
export function applyReview(record: ExampleRecord, review: Review | null): ExampleRecord {
  const { original, ...meta } = record.meta;
  if (review === null) {
    if (!original) return { ...record, meta: { ...meta, status: "pending", note: undefined } };
    const answer = JSON.parse(original.answer) as Record<string, string | number>;
    return {
      messages: [
        { role: "system", content: systemPromptFor(original.action as Action) },
        record.messages[1],
        { role: "assistant", content: original.answer },
      ],
      meta: { ...meta, action: original.action, present: Object.keys(answer).filter((name) => answer[name] !== "" && answer[name] !== 0), status: "pending", note: undefined },
    };
  }
  const note = review.note?.trim() || undefined;
  if (review.expectedAction === "none") return { ...record, meta: { ...record.meta, status: "rejected", note } };
  if (!(review.expectedAction in CATALOG)) throw new Error(`${record.meta.id}: "${review.expectedAction}" isn't an action.`);

  const action = review.expectedAction as Action;
  const rebuilt = toRecord(exampleFrom(record, action, review.expectedParams));
  const changed = action !== record.meta.action || rebuilt.messages[2].content !== record.messages[2].content;
  return {
    messages: rebuilt.messages,
    meta: {
      ...rebuilt.meta,
      source: record.meta.source,
      status: "approved",
      note,
      ...(record.meta.trainOnly ? { trainOnly: true } : {}),
      ...(record.meta.split ? { split: record.meta.split } : {}),
      ...(record.meta.pattern ? { pattern: record.meta.pattern } : {}),
      ...(record.meta.version ? { version: record.meta.version } : {}),
      ...(record.meta.retired ? { retired: record.meta.retired } : {}),
      // Keep the generator's first answer, not an earlier correction.
      original: original ?? (changed ? { action: record.meta.action, answer: record.messages[2].content } : undefined),
    },
  };
}

/** The review a row currently carries, in the annotate page's terms, or null while pending. */
export function reviewOf(record: ExampleRecord): Review | null {
  const note = record.meta.note ?? "";
  if (record.meta.status === "rejected") return { expectedAction: "none", expectedParams: {}, note };
  if (record.meta.status !== "approved") return null;
  const answer = JSON.parse(record.messages[2].content) as Record<string, string | number>;
  const expectedParams = Object.fromEntries(
    Object.entries(answer).flatMap(([name, value]) => (value === "" || value === 0 ? [] : [[name, String(value)]])),
  );
  return { expectedAction: record.meta.action, expectedParams, note };
}
