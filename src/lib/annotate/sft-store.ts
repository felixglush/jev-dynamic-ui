import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { MAX_MESSAGE_LENGTH } from "@/lib/jev/catalog";
import { freeTextParams } from "@/lib/extract/prompt";
import { addExamples, applyReview, parseExamples, serializeExamples, type ExampleRecord } from "@/lib/sft/examples";
import { isKind } from "@/lib/sft/kinds";
import { datasetFromReviews, isActionName, sanitizeAnnotations, type Annotation, type Dataset } from "./dataset";

/**
 * The examples file (data/sft/examples.jsonl) the annotate page reviews in place: each answer you give is written into the
 * row itself (status, corrected values), so the file is ready for `npm run sft:build` as you go.
 * Set SFT_REVIEW_FILE to use another path.
 */
const DEFAULT_SFT_FILE = "data/sft/examples.jsonl";

function sftPath() {
  return path.resolve(process.cwd(), process.env.SFT_REVIEW_FILE || DEFAULT_SFT_FILE);
}

export function sftLabel() {
  return path.relative(process.cwd(), sftPath());
}

async function readRecords() {
  return parseExamples(await readFile(sftPath(), "utf8"));
}

async function writeRecords(records: ReturnType<typeof parseExamples>) {
  const file = sftPath();
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, serializeExamples(records));
  await rename(temp, file);
}

/** The file as rows to review plus the reviews it already holds. Not cached: it changes as you work. */
export async function readReviewDataset(): Promise<Dataset> {
  return datasetFromReviews(await readRecords());
}

// Saves run one at a time so two quick answers can't interleave their writes.
let queue: Promise<unknown> = Promise.resolve();

/** `changes` maps a row id to its review, or to null to take the review back. Applied to what is on disk now. */
export function writeReviewChanges(raw: unknown): Promise<void> {
  const run = async () => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("Changes must be an object.");
    const records = await readRecords();
    const entries = Object.entries(raw);
    const { predictions } = datasetFromReviews(records);
    const set = sanitizeAnnotations(predictions, Object.fromEntries(entries.filter(([, value]) => value !== null)));
    const known = new Set(records.map((r) => r.meta.id));
    const unknown = entries.find(([id, value]) => value === null && !known.has(id));
    if (unknown) throw new Error(`Unknown row id ${unknown[0]}.`);

    const next = records.map((record) => {
      const id = record.meta.id;
      if (!(id in raw)) return record;
      const review: Annotation | undefined = set[id];
      return applyReview(record, review ? { expectedAction: review.expectedAction, expectedParams: review.expectedParams, note: review.note, kind: review.kind } : null);
    });
    await writeRecords(next);
  };
  return enqueue(run);
}

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Put an answer approved on the real predictions page into the examples file as an approved,
 * train-only row (it never lands in val or test, so scored sets stay as they were). A message that
 * is already in the file for that action is left as it is. Actions with only choice fields (nothing for the extractor to read) are skipped too. Returns the row id, or why it was skipped.
 */
export function addApprovedExample(raw: unknown): Promise<{ id: string } | { skipped: "duplicate" | "no-fields" }> {
  return enqueue(async () => {
    const row = raw as { action?: unknown; message?: unknown; params?: unknown; kind?: unknown; note?: unknown };
    if (typeof row?.action !== "string" || !isActionName(row.action)) throw new Error("Unknown action.");
    if (typeof row.message !== "string" || !row.message.trim() || row.message.length > MAX_MESSAGE_LENGTH) throw new Error("Message must be text of a sensible length.");
    if (!isKind(row.kind)) throw new Error("Unknown kind of example.");
    if (freeTextParams(row.action).length === 0) return { skipped: "no-fields" as const };
    const given = typeof row.params === "object" && row.params !== null && !Array.isArray(row.params) ? (row.params as Record<string, unknown>) : {};
    const expectedParams = Object.fromEntries(Object.entries(given).flatMap(([name, value]) => (typeof value === "string" && value.trim() ? [[name, value.trim().slice(0, 200)]] : [])));
    const note = typeof row.note === "string" ? row.note.trim().slice(0, 500) : undefined;

    const records: ExampleRecord[] = await readRecords().catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const message = row.message.trim();
    const { records: all, skipped } = addExamples(records, [{ id: "approved", action: row.action, message, fields: {}, vague: false }], "sample", { trainOnly: true, kind: row.kind });
    if (skipped.length > 0) return { skipped: "duplicate" as const };
    const added = all.find((r) => r.messages[1].content === message && r.meta.action === row.action && !records.includes(r))!;
    const reviewed = applyReview(added, { expectedAction: row.action, expectedParams, note, kind: row.kind });
    await writeRecords(all.map((r) => (r === added ? reviewed : r)));
    return { id: reviewed.meta.id };
  });
}
