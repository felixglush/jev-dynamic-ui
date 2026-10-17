"use server";

import { annotationsLabel, readAnnotationsFile, writeAnnotationChanges } from "@/lib/annotate/store";
import { isActionName, type Annotation, type Annotations, type Dataset } from "@/lib/annotate/dataset";
import { addApprovedExample as appendApprovedExample, readReviewDataset, splitsOfMessages, sftLabel, writeReviewChanges } from "@/lib/annotate/sft-store";
import { extractFields } from "@/lib/extract/ollama";
import { MAX_MESSAGE_LENGTH } from "@/lib/jev/catalog";

export type LoadResult = { ok: true; annotations: Annotations | null; path: string } | { ok: false; error: string };
export type SaveResult = { ok: true; path: string } | { ok: false; error: string };

/**
 * Server Actions for the annotation page. Like classifyMessage they are public POST endpoints, so
 * the data is validated before it is written, and the path is fixed on the server, never taken from
 * the browser. Add authentication here before deploying.
 */
export async function loadSavedAnnotations(): Promise<LoadResult> {
  try {
    return { ok: true, annotations: await readAnnotationsFile(), path: annotationsLabel() };
  } catch (error) {
    console.error("loadSavedAnnotations failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't read the file." };
  }
}

/** `changes` maps a message id to its new annotation, or to null to remove it. */
export async function saveAnnotationsToFile(changes: Record<string, Annotation | null>): Promise<SaveResult> {
  try {
    await writeAnnotationChanges(changes);
    return { ok: true, path: annotationsLabel() };
  } catch (error) {
    console.error("saveAnnotationsToFile failed:", error);
    return { ok: false, error: "Couldn't write the file." };
  }
}

export type ExtractResult =
  | { ok: true; fields: Record<string, string | number | null> }
  | { ok: false; error: string };

/**
 * Ask the local LiquidFM extractor for an action's free-text fields. The annotation screen calls
 * this once per message, with the action Jev picked. Same rule as above: public endpoint, so the
 * arguments are checked, and only the values go back to the browser.
 */
export async function extractMessageFields(action: string, message: string): Promise<ExtractResult> {
  if (typeof action !== "string" || !isActionName(action)) return { ok: false, error: "Unknown action." };
  if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: "Message must be text of a sensible length." };
  }
  try {
    const fields = await extractFields(action, message.trim());
    return { ok: true, fields: Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value])) };
  } catch (error) {
    console.error("extractMessageFields failed:", error);
    return { ok: false, error: "Couldn't reach the extractor. Is Ollama running?" };
  }
}

export type SftLoadResult = { ok: true; dataset: Dataset; path: string } | { ok: false; error: string };

/** The examples file as rows to review, with the reviews already saved in it. */
export async function loadSftReviews(): Promise<SftLoadResult> {
  try {
    return { ok: true, dataset: await readReviewDataset(), path: sftLabel() };
  } catch (error) {
    console.error("loadSftReviews failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't read the file." };
  }
}

/** Same shape as loadSavedAnnotations, for the SFT file. */
export async function loadSftAnnotations(): Promise<LoadResult> {
  const loaded = await loadSftReviews();
  return loaded.ok ? { ok: true, annotations: loaded.dataset.annotations, path: loaded.path } : loaded;
}

/** Write reviews into the SFT file's rows: an annotation approves or corrects a row, "none" rejects it, null undoes. */
export async function saveSftReviews(changes: Record<string, Annotation | null>): Promise<SaveResult> {
  try {
    await writeReviewChanges(changes);
    return { ok: true, path: sftLabel() };
  } catch (error) {
    console.error("saveSftReviews failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't write the file." };
  }
}

export type TrainingResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * An answer approved or corrected on the real predictions page becomes an approved, train-only row in
 * the fine-tuning file. Same rule as the other actions: public endpoint, so the store checks the input.
 */
export async function addApprovedExample(row: { action: string; message: string; params: Record<string, string>; kind: string; note: string }): Promise<TrainingResult> {
  try {
    const result = await appendApprovedExample(row);
    if ("id" in result) return { ok: true, message: `Added to the fine-tuning data (${result.id}, ${sftLabel()})` };
    if (result.skipped === "no-fields") return { ok: true, message: "Not added: this action has no typed-in fields for the extractor to read" };
    const where = result.split === "val" || result.split === "test" ? `, held out in ${result.split}, so never trained on` : result.split ? ` (${result.split})` : "";
    return { ok: true, message: `Already in the fine-tuning data${where}` };
  } catch (error) {
    console.error("addApprovedExample failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't write the file." };
  }
}

/** Where the fine-tuning file already holds each message (train, val, test or pending), so held-out ones can be flagged. */
export async function messageSplits(messages: string[]): Promise<Record<string, string>> {
  try {
    return await splitsOfMessages(messages);
  } catch (error) {
    console.error("messageSplits failed:", error);
    return {};
  }
}
