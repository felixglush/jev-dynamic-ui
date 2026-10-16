import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseDataset, type Dataset } from "./dataset";

/** The predictions CSV that `npm run predict` writes at the project root. */
export const DEFAULT_PREDICTIONS_FILE = "predictions.csv";

/**
 * Read the default predictions on the server. `"use cache"` lets Next.js run this once at build
 * time and bake the result into the page, instead of reading the file on every request. Rebuild
 * (or restart `next dev`) after re-running `npm run predict`, or use Import in the page.
 */
export async function loadDefaultDataset(): Promise<Dataset> {
  "use cache";
  const text = await readFile(path.join(process.cwd(), DEFAULT_PREDICTIONS_FILE), "utf8");
  return parseDataset(text);
}
