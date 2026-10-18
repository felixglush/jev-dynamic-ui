"use server";

import { createStt } from "@/lib/stt";
import { transcribeClip } from "@/lib/stt/transcribe";
import type { TranscribeOutcome } from "@/lib/stt/types";

/**
 * Server Action for the microphone button: recorded audio in, text out. It only transcribes; the text then goes
 * through classifyMessage like anything typed. Like every Server Action it is a public endpoint: add
 * authentication and rate limiting before deploying.
 */
export async function transcribeAudio(formData: FormData): Promise<TranscribeOutcome> {
  return transcribeClip(formData.get("audio"), createStt());
}
