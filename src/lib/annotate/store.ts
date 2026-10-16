import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { annotationsFor, parseDataset, sanitizeAnnotations, serializeDataset, type Annotations } from "./dataset";
import { loadDefaultDataset } from "./load";

/**
 * Where annotations are saved on the server's disk: the predictions CSV with the expected columns
 * filled in, the same file Download CSV gives you. Set ANNOTATIONS_FILE to put it elsewhere.
 */
const DEFAULT_ANNOTATIONS_FILE = "data/annotations.csv";

function annotationsPath() {
  return path.resolve(process.cwd(), process.env.ANNOTATIONS_FILE || DEFAULT_ANNOTATIONS_FILE);
}

/** The path as shown to the person annotating, relative to the project. */
export function annotationsLabel() {
  return path.relative(process.cwd(), annotationsPath());
}

/** Annotations saved on disk for the default predictions, or null when nothing has been saved yet. */
export async function readAnnotationsFile(): Promise<Annotations | null> {
  let text: string;
  try {
    text = await readFile(annotationsPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const { predictions } = await loadDefaultDataset();
  return annotationsFor(predictions, parseDataset(text));
}

// Saves run one at a time so two quick answers can't interleave their writes.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Apply changes to the saved annotations: an annotation sets that message's answer, null removes it.
 * Only the changed messages are sent, and they are applied to what is on disk right now, so a second
 * tab with an older view can't wipe answers it never saw. Writes to a temp file first, then renames.
 */
export function writeAnnotationChanges(raw: unknown): Promise<void> {
  const run = async () => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("Changes must be an object.");
    const { predictions } = await loadDefaultDataset();
    const entries = Object.entries(raw);
    const removed = entries.filter(([, value]) => value === null).map(([id]) => id);
    const set = sanitizeAnnotations(predictions, Object.fromEntries(entries.filter(([, value]) => value !== null)));
    const known = new Set(predictions.map((p) => p.id));
    const unknown = removed.find((id) => !known.has(id));
    if (unknown !== undefined) throw new Error(`Unknown message id ${unknown}.`);

    // Throws when the file exists but can't be read, so a hand-edited file is never overwritten.
    const annotations = { ...(await readAnnotationsFile()), ...set };
    for (const id of removed) delete annotations[id];

    const file = annotationsPath();
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, serializeDataset({ predictions, annotations }));
    await rename(temp, file);
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
