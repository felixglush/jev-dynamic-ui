"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_RECORDING_MS } from "@/lib/stt/limits";

export type RecorderState = "idle" | "recording";

/**
 * Records from the microphone and hands the finished clip to `onClip`. It knows nothing about what happens to the
 * audio next. `onError` gets a message fit to show the customer (permission denied, no microphone).
 */
export function useRecorder(onClip: (clip: Blob) => void, onError: (message: string) => void) {
  const [state, setState] = useState<RecorderState>("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Always call the newest callbacks, even from a recording started before the last render.
  const callbacks = useRef({ onClip, onError });
  useEffect(() => {
    callbacks.current = { onClip, onError };
  });

  const stop = useCallback(() => {
    clearTimeout(stopTimer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorder.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => chunks.push(event.data);
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop()); // turns the browser's "recording" indicator off
        recorder.current = null;
        setState("idle");
        callbacks.current.onClip(new Blob(chunks, { type: media.mimeType }));
      };
      recorder.current = media;
      media.start();
      setState("recording");
      stopTimer.current = setTimeout(stop, MAX_RECORDING_MS);
    } catch {
      callbacks.current.onError("I couldn't use the microphone. Allow microphone access, or type your request.");
    }
  }, [stop]);

  // Leaving the page mid-recording must release the microphone.
  useEffect(
    () => () => {
      clearTimeout(stopTimer.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  return { state, start, stop };
}
