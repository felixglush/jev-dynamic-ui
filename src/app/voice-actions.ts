"use server";

import { createStt } from "@/lib/stt";
import { listSttModels } from "@/lib/stt/models";
import { transcribeClip } from "@/lib/stt/transcribe";
import type { SttModels, TranscribeOutcome } from "@/lib/stt/types";

/**
 * Server Action for the microphone button: recorded audio in, text out. It only transcribes; the text then goes
 * through classifyMessage like anything typed. Like every Server Action it is a public endpoint: add
 * authentication and rate limiting before deploying.
 */
export async function transcribeAudio(formData: FormData): Promise<TranscribeOutcome> {
  // The model the customer picked in the dropdown. It is only a name passed on to the speech server, which refuses
  // any it doesn't know, but it is still input from a public endpoint, so anything that isn't a plain name is dropped.
  const picked = formData.get("model");
  const model = typeof picked === "string" && /^[\w.\-/]{1,100}$/.test(picked) ? picked : undefined;
  return transcribeClip(formData.get("audio"), createStt(process.env, model));
}

/** The models the speech server offers, for the chat's dropdown. */
export async function getSttModels(): Promise<SttModels> {
  return listSttModels();
}

export type SpeechConfig = {
  /** Where the browser sends live audio, or null to record first and transcribe after. */
  streamUrl: string | null;
  /** Whether the text appears in the message bar while the customer is still speaking (STT_LIVE_TEXT=off hides it). */
  liveText: boolean;
  /** Whether the recording is transcribed once more by the batch engine (STT_URL) when the customer stops (STT_REFINE=on). */
  refine: boolean;
};

/**
 * How the microphone should behave, read when asked rather than baked into the build, so one build runs anywhere.
 * STT_STREAM_URL is a ws:// or wss:// address; none of these values is a secret: the browser connects to the address
 * directly.
 */
export async function getSpeechConfig(): Promise<SpeechConfig> {
  return {
    streamUrl: process.env.STT_STREAM_URL || null,
    liveText: process.env.STT_LIVE_TEXT !== "off",
    refine: process.env.STT_REFINE === "on",
  };
}
