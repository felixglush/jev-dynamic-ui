import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { connection } from "next/server";

import { parseDataset, type Dataset } from "./dataset";

/** The predictions CSV: `npm run predict` writes it, and the chat appends every message it classifies. */
export const DEFAULT_PREDICTIONS_FILE = "predictions.csv";

/** PREDICTIONS_FILE points the page at another file (the end-to-end tests use a small fixed one). */
const predictionsFile = () => process.env.PREDICTIONS_FILE || DEFAULT_PREDICTIONS_FILE;

/**
 * Read the predictions on the server, on every request, because the chat keeps adding to the file.
 * A missing or empty file is an empty list, not an error.
 */
export async function loadDefaultDataset(): Promise<Dataset> {
  await connection();
  const text = await readFile(path.resolve(process.cwd(), predictionsFile()), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (!text.trim() || text.trim().split("\n").length < 2) return { predictions: [], annotations: {} };
  return parseDataset(text);
}
