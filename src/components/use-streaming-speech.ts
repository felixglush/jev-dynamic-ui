"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { startPcmCapture, type PcmCapture } from "@/lib/stt/stream/capture";
import { WebSocketTranscriber, type StreamingTranscriber } from "@/lib/stt/stream/transcriber";
import { MAX_RECORDING_MS } from "@/lib/stt/limits";
import { encodeWav } from "@/lib/stt/stream/wav";

export type StreamingSpeechState = "idle" | "connecting" | "recording" | "finishing";

type Handlers = {
  onPartial: (text: string) => void;
  /** `clip` is everything that was recorded, for a second opinion from another engine. */
  onFinal: (text: string, clip: Blob) => void;
  onError: (message: string) => void;
};

const MIC_ERROR = "I couldn't use the microphone. Allow microphone access, or type your request.";

/**
 * Live speech to text: opens the microphone and a streaming transcription session and joins them. It knows
 * nothing about what the text is for. `createTranscriber` says which engine to talk to.
 */
export function useStreamingSpeech(createTranscriber: () => StreamingTranscriber, handlers: Handlers) {
  const [state, setState] = useState<StreamingSpeechState>("idle");
  const session = useRef<{ transcriber: StreamingTranscriber; capture: PcmCapture | null; frames: Int16Array[] } | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Always call the newest handlers and factory, even from a session started before the last render.
  const latest = useRef({ createTranscriber, handlers });
  useEffect(() => {
    latest.current = { createTranscriber, handlers };
  });

  const end = useCallback(() => {
    clearTimeout(stopTimer.current);
    void session.current?.capture?.stop();
    session.current?.transcriber.close();
    session.current = null;
    setState("idle");
  }, []);

  const stop = useCallback(() => {
    const current = session.current;
    if (!current) return;
    clearTimeout(stopTimer.current);
    const capture = current.capture;
    current.capture = null;
    setState("finishing");
    // Let the microphone hand over its last audio first, so the final word isn't cut off. The final text then
    // arrives through onFinal, which ends the session.
    void (capture?.stop() ?? Promise.resolve()).then(() => current.transcriber.stop());
  }, []);

  const start = useCallback(async () => {
    if (session.current) return;
    const transcriber = latest.current.createTranscriber();
    const current = { transcriber, capture: null as PcmCapture | null, frames: [] as Int16Array[] };
    session.current = current;
    setState("connecting");
    try {
      await transcriber.start({
        onPartial: (text) => latest.current.handlers.onPartial(text),
        onEndpoint: stop, // the server heard the customer finish: same as pressing stop
        onFinal: (text) => {
          const clip = encodeWav(current.frames);
          end();
          latest.current.handlers.onFinal(text, clip);
        },
        onError: (message) => {
          end();
          latest.current.handlers.onError(message);
        },
      });
    } catch (error) {
      end();
      latest.current.handlers.onError(error instanceof Error ? error.message : "Speech-to-text isn't available.");
      return;
    }
    try {
      current.capture = await startPcmCapture((pcm) => {
        current.frames.push(pcm);
        transcriber.send(pcm);
      });
    } catch {
      end();
      latest.current.handlers.onError(MIC_ERROR);
      return;
    }
    if (session.current !== current) return void current.capture.stop(); // ended while the microphone was opening
    setState("recording");
    stopTimer.current = setTimeout(stop, MAX_RECORDING_MS);
  }, [end, stop]);

  // Leaving the page mid-recording must release the microphone and the connection.
  useEffect(() => end, [end]);

  return { state, start, stop };
}

/** The default engine: the streaming server at `url`. */
export const webSocketTranscriber = (url: string) => () => new WebSocketTranscriber(url);
