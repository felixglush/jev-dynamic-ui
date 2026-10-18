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
