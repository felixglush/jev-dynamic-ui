"use server";

import { annotationsLabel, readAnnotationsFile, writeAnnotationChanges } from "@/lib/annotate/store";
import type { Annotation, Annotations } from "@/lib/annotate/dataset";

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
