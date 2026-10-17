import "server-only";

import { appendFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ClassifyResult } from "@/lib/jev/types";
import { OLLAMA_MODEL } from "@/lib/extract/ollama";
import { csvCell, describe, LOG_HEADER } from "./predictions-csv";
import { DEFAULT_PREDICTIONS_FILE } from "./load";

/**
 * Every message sent in the chat is appended to the predictions file (what Jev said about it, and what the extractor read, with its model name; a blank value means it found nothing), so the
 * Predictions tab on /annotate holds real traffic to review. PREDICTIONS_LOG_FILE sends the log elsewhere
 * (the end-to-end tests do, so chat tests never change the file the annotate tests read).
 */
function logPath() {
  return path.resolve(process.cwd(), process.env.PREDICTIONS_LOG_FILE || process.env.PREDICTIONS_FILE || DEFAULT_PREDICTIONS_FILE);
}

let queue: Promise<unknown> = Promise.resolve();

/** Never throws: a log that can't be written must not break the chat. */
export function logPrediction(message: string, result: ClassifyResult, extracted: Record<string, string> | null = null): Promise<void> {
  const run = async () => {
    const file = logPath();
    await mkdir(path.dirname(file), { recursive: true });
    const exists = await stat(file).then((s) => s.size > 0, () => false);
    const d = describe(result);
    const id = `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const row = [id, "live", message, d.action, d.confidence, d.params, d.missing, "", d.note, extracted ? Object.entries(extracted).map(([name, value]) => `${name}=${value}`).join("; ") : "", extracted ? OLLAMA_MODEL : ""].map(csvCell).join(",");
    await appendFile(file, `${exists ? "" : LOG_HEADER.join(",") + "\n"}${row}\n`);
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next.catch((error) => console.error("logPrediction failed:", error));
}
