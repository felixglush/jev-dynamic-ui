import type { SttProvider } from "./types";

/**
 * Talks to any server that implements OpenAI's `POST /v1/audio/transcriptions`: faster-whisper-server,
 * whisper.cpp's server and vLLM (which serves Qwen3-ASR) all do. Swapping Whisper for Qwen3-ASR is then a change of
 * STT_URL and STT_MODEL, not a new class.
 */
/** The server decides the format from the file name, so give it one that matches what the browser recorded. */
function fileNameFor(audio: Blob): string {
  if (audio.type.includes("mp4")) return "audio.m4a";
  if (audio.type.includes("ogg")) return "audio.ogg";
  if (audio.type.includes("wav")) return "audio.wav";
  return "audio.webm";
}

export class OpenAiCompatibleStt implements SttProvider {
  readonly name: string;

  constructor(
    private readonly url: string,
    private readonly model: string,
    private readonly timeoutMs = 30_000,
  ) {
    this.name = `openai-compatible:${model}`;
  }

  async transcribe(audio: Blob): Promise<string> {
    const body = new FormData();
    body.set("file", audio, fileNameFor(audio));
    body.set("model", this.model);
    body.set("language", "en"); // English only
    body.set("response_format", "json");
    const response = await fetch(`${this.url}/v1/audio/transcriptions`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Speech-to-text server answered ${response.status}`);
    const { text } = (await response.json()) as { text?: unknown };
    if (typeof text !== "string") throw new Error("Speech-to-text server sent no text");
    return text.trim();
  }
}
