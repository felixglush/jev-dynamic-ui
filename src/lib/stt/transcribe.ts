import "server-only";

import { MAX_AUDIO_BYTES } from "./limits";
import type { SttProvider, TranscribeOutcome } from "./types";

/**
 * Check an uploaded clip and turn it into text with whichever engine is given. The engine is passed in rather
 * than looked up here, so this function neither knows nor cares which model is behind it (and tests hand it a fake).
 * The clip comes from the public Server Action endpoint, so it is treated as untrusted.
 */
export async function transcribeClip(clip: unknown, stt: SttProvider): Promise<TranscribeOutcome> {
  if (!(clip instanceof Blob) || clip.size === 0) return { ok: false, error: "No audio was received." };
  if (clip.size > MAX_AUDIO_BYTES) return { ok: false, error: "That recording is too long. Keep it under 20 seconds." };

  try {
    const text = await stt.transcribe(clip);
    if (!text) return { ok: false, error: "I couldn't hear anything. Try again, a bit closer to the microphone." };
    return { ok: true, text };
  } catch (error) {
    // Log the detail on the server; send the browser only a generic message.
    console.error(`transcribe failed (${stt.name}):`, error);
    return { ok: false, error: "The speech-to-text service isn't reachable. You can still type your request." };
  }
}
