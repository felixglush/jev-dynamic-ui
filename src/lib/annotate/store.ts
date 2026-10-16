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

/** Write all annotations to disk, replacing the file. Writes to a temp file first, then renames. */
export function writeAnnotationsFile(raw: unknown): Promise<void> {
  const run = async () => {
    const { predictions } = await loadDefaultDataset();
    const annotations = sanitizeAnnotations(predictions, raw);
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
