import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { applyReview, parseSynthetic, serializeSynthetic } from "@/lib/sft/synthetic";
import { datasetFromReviews, sanitizeAnnotations, type Annotation, type Dataset } from "./dataset";

/**
 * The synthetic SFT file the annotate page reviews in place: each answer you give is written into the
 * row itself (status, corrected values), so the file is ready for `npm run sft:build` as you go.
 * Set SFT_REVIEW_FILE to use another path.
 */
const DEFAULT_SFT_FILE = "data/sft/synthetic.jsonl";

function sftPath() {
  return path.resolve(process.cwd(), process.env.SFT_REVIEW_FILE || DEFAULT_SFT_FILE);
}

export function sftLabel() {
  return path.relative(process.cwd(), sftPath());
}

async function readRecords() {
  return parseSynthetic(await readFile(sftPath(), "utf8"));
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
      return applyReview(record, review ? { expectedAction: review.expectedAction, expectedParams: review.expectedParams, note: review.note } : null);
    });
    const file = sftPath();
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, serializeSynthetic(next));
    await rename(temp, file);
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
