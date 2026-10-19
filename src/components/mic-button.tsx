"use client";

import { MicView } from "@/components/mic-view";
import { RecordedMicButton, type MicProps } from "@/components/recorded-mic-button";
import { StreamingMicButton } from "@/components/streaming-mic-button";
import type { SpeechConfig } from "@/app/voice-actions";

/**
 * The microphone button: live streaming when the server has a speech server configured, otherwise record then
 * transcribe. It shows a disabled button until the page knows which (`speech` is undefined until then).
 */
export function MicButton({ speech, ...props }: MicProps & { speech: SpeechConfig | undefined }) {
  if (!speech) return <MicView state="busy" onClick={() => {}} />;
  return speech.streamUrl ? (
    <StreamingMicButton url={speech.streamUrl} refine={speech.refine} {...props} />
  ) : (
    <RecordedMicButton {...props} />
  );
}
