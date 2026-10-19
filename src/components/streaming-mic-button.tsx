"use client";

import { transcribeAudio } from "@/app/voice-actions";
import { MicView } from "@/components/mic-view";
import type { MicProps } from "@/components/recorded-mic-button";
import { useStreamingSpeech, webSocketTranscriber } from "@/components/use-streaming-speech";
import { normalizeSpoken } from "@/lib/stt/normalize";

/**
 * Press to start talking, press again to stop. The audio streams to the speech server as it is recorded and the
 * text comes back while you speak (`final` false) and once more when you stop (`final` true). Streaming engines
 * write numbers and emails as words, so the text is cleaned up (src/lib/stt/normalize.ts) before anyone sees it.
 *
 * With `refine`, the finished recording is also sent to the batch engine (STT_URL), which is slower but more
 * accurate; if it hears something different, its text is passed on as a correction of the streamed one.
 */
export function StreamingMicButton({ url, refine, onTranscript, onError }: MicProps & { url: string; refine: boolean }) {
  async function correct(streamed: string, clip: Blob) {
    const body = new FormData();
    body.set("audio", clip);
    try {
      const outcome = await transcribeAudio(body);
      // A second engine that fails or hears nothing is not worth a message: the streamed text already stands.
      if (!outcome.ok) return;
      const text = normalizeSpoken(outcome.text);
      if (text && text !== streamed) onTranscript(text, true, streamed);
    } catch {
      // Same: keep the streamed text.
    }
  }

  const { state, start, stop } = useStreamingSpeech(webSocketTranscriber(url), {
    onPartial: (text) => onTranscript(normalizeSpoken(text), false),
    onFinal: (text, clip) => {
      const streamed = normalizeSpoken(text);
      onTranscript(streamed, true);
      if (clip && streamed) void correct(streamed, clip);
    },
    onError,
  }, refine);

  return (
    <MicView
      state={state === "idle" ? "idle" : state === "recording" ? "recording" : "busy"}
      onClick={state === "recording" ? stop : () => void start()}
    />
  );
}
