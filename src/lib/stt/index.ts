import "server-only";

import { OpenAiCompatibleStt } from "./openai-compatible";
import type { SttProvider } from "./types";

export type { SttProvider };

type SttEnv = Record<string, string | undefined>;

/**
 * The factory: STT_PROVIDER names an entry here, and the entry builds it from the rest of the config. To add an
 * engine, write a class that implements SttProvider and add one line.
 */
const PROVIDERS: Record<string, (env: SttEnv) => SttProvider> = {
  "openai-compatible": (env) =>
    new OpenAiCompatibleStt(env.STT_URL ?? "http://127.0.0.1:8000", env.STT_MODEL ?? "Systran/faster-whisper-small.en"),
};

export function createStt(env: SttEnv = process.env): SttProvider {
  const kind = env.STT_PROVIDER ?? "openai-compatible";
  const build = PROVIDERS[kind];
  if (!build) throw new Error(`Unknown STT_PROVIDER "${kind}". Known: ${Object.keys(PROVIDERS).join(", ")}`);
  return build(env);
}
