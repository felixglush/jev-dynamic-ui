import "server-only";

import type { SttModels } from "./types";

const NONE: SttModels = { default: null, models: [] };

/**
 * Asks the speech server (STT_URL) which models it can run, for the chat's dropdown. Any server that answers
 * OpenAI's `GET /v1/models` works; voice/server/whisper_server.py also sends a label, whether each model can run
 * (`available`) and its default. A server that is down, or lists nothing, gives an empty list and the dropdown
 * stays hidden.
 */
export async function listSttModels(env: Record<string, string | undefined> = process.env): Promise<SttModels> {
  const url = env.STT_URL ?? "http://127.0.0.1:8000";
  try {
    const response = await fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(2_000), cache: "no-store" });
    if (!response.ok) return NONE;
    const body = (await response.json()) as { default?: unknown; data?: unknown };
    if (!Array.isArray(body.data)) return NONE;
    const models = body.data.flatMap((row: unknown) => {
      const { id, label, available } = (row ?? {}) as Record<string, unknown>;
      if (typeof id !== "string" || available === false) return [];
      return [{ id, label: typeof label === "string" ? label : id }];
    });
    const fallback = typeof body.default === "string" && models.some((m) => m.id === body.default) ? body.default : null;
    return { default: fallback, models };
  } catch {
    return NONE;
  }
}
