"use server";

import { annotationsLabel, readAnnotationsFile, writeAnnotationChanges } from "@/lib/annotate/store";
import { isActionName, type Annotation, type Annotations } from "@/lib/annotate/dataset";
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
