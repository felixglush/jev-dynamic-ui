/**
 * The synthetic (generated) training rows and their review state, kept in one JSONL file
 * (data/sft/synthetic.jsonl). Same record format as the other SFT files, plus review fields in `meta`:
 *
 *   status    "pending" (not looked at), "approved" (goes into training) or "rejected" (never used)
 *   original  what the generator wrote, kept once a reviewer changes it, so the page can show the
 *             correction and "undo" can restore it
 *   note      the reviewer's note
 *
 * The annotate page edits this file in place; `npm run sft:build` trains on the approved rows.
 */
import { CATALOG } from "@/lib/jev/catalog";
import { freeTextParams, systemPromptFor } from "@/lib/extract/prompt";
import { toRecord, type SftRecord } from "./record";
import type { Action, LabeledExample } from "./seed";

export type ReviewStatus = "pending" | "approved" | "rejected";

export type SyntheticRecord = SftRecord & {
  meta: SftRecord["meta"] & { source: "synthetic"; status: ReviewStatus; original?: { action: string; answer: string }; note?: string };
};

/** What a reviewer decided: an action ("none" rejects the row) and the values, as the annotate form gives them. */
export type Review = { expectedAction: string; expectedParams: Record<string, string>; note?: string };

export const normalizeMessage = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
export const messageKey = (action: string, message: string) => `${action}|${normalizeMessage(message)}`;

export function parseSynthetic(text: string): SyntheticRecord[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      const record = JSON.parse(line) as SyntheticRecord;
      if (record.meta?.source !== "synthetic") throw new Error(`Line ${index + 1}: not a synthetic record.`);
      return record;
    });
}

export const serializeSynthetic = (records: SyntheticRecord[]) => records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");

/** Append new generated examples as pending rows. Duplicates of anything in `existingKeys` are skipped and reported. */
export function addExamples(
  records: SyntheticRecord[],
  examples: LabeledExample[],
  existingKeys: Set<string>,
): { records: SyntheticRecord[]; skipped: { message: string; reason: string }[] } {
  const keys = new Set(existingKeys);
  for (const r of records) keys.add(messageKey(r.meta.action, r.messages[1].content));
  let next = records.reduce((max, r) => Math.max(max, Number(r.meta.id.replace(/\D/g, "")) || 0), 0) + 1;
  const added = [...records];
  const skipped: { message: string; reason: string }[] = [];
  for (const example of examples) {
    const key = messageKey(example.action, example.message);
    if (keys.has(key)) {
      skipped.push({ message: example.message, reason: "already in the seed set or the synthetic file" });
      continue;
    }
    keys.add(key);
    const id = `syn-${String(next++).padStart(4, "0")}`;
    const record = toRecord({ ...example, id });
    added.push({ ...record, meta: { ...record.meta, source: "synthetic", status: "pending" } });
  }
  return { records: added, skipped };
}

/** The review form's values for the action's free-text fields, as a labeled example. Throws on a bad amount. */
function exampleFrom(record: SyntheticRecord, action: Action, params: Record<string, string>): LabeledExample {
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
export function applyReview(record: SyntheticRecord, review: Review | null): SyntheticRecord {
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
      source: "synthetic",
      status: "approved",
      note,
      // Keep the generator's first answer, not an earlier correction.
      original: original ?? (changed ? { action: record.meta.action, answer: record.messages[2].content } : undefined),
    },
  };
}

/** The review a row currently carries, in the annotate page's terms, or null while pending. */
export function reviewOf(record: SyntheticRecord): Review | null {
  const note = record.meta.note ?? "";
  if (record.meta.status === "rejected") return { expectedAction: "none", expectedParams: {}, note };
  if (record.meta.status !== "approved") return null;
  const answer = JSON.parse(record.messages[2].content) as Record<string, string | number>;
  const expectedParams = Object.fromEntries(
    Object.entries(answer).flatMap(([name, value]) => (value === "" || value === 0 ? [] : [[name, String(value)]])),
  );
  return { expectedAction: record.meta.action, expectedParams, note };
}
