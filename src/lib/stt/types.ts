/**
 * A speech-to-text engine. The app only knows this shape, so a model can be swapped by changing config
 * (see index.ts), not code.
 */
export interface SttProvider {
  /** Shown in logs and the UI, e.g. "openai-compatible:small.en". */
  readonly name: string;
  /** Turn one recorded clip into the text that was said. Throws if the engine can't be reached. */
  transcribe(audio: Blob): Promise<string>;
}

/** A speech model the batch engine can run, as the app's dropdown shows it. */
export type SttModel = { id: string; label: string };

/** The models on offer and which one the server uses when none is named. Empty when the server doesn't list any. */
export type SttModels = { default: string | null; models: SttModel[] };

/** What the browser gets back: plain data, never an exception. */
export type TranscribeOutcome = { ok: true; text: string } | { ok: false; error: string };
