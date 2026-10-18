"use client";

import { MicView } from "@/components/mic-view";
import type { MicProps } from "@/components/recorded-mic-button";
import { useStreamingSpeech, webSocketTranscriber } from "@/components/use-streaming-speech";

/**
 * Press to start talking, press again to stop. The audio streams to the speech server as it is recorded and the
 * text comes back while you speak (`final` false) and once more when you stop (`final` true).
 */
export function StreamingMicButton({ url, onTranscript, onError }: MicProps & { url: string }) {
  const { state, start, stop } = useStreamingSpeech(webSocketTranscriber(url), {
    onPartial: (text) => onTranscript(text, false),
    onFinal: (text) => onTranscript(text, true),
    onError,
  });

  return (
    <MicView
      state={state === "idle" ? "idle" : state === "recording" ? "recording" : "busy"}
      onClick={state === "recording" ? stop : () => void start()}
    />
  );
}
