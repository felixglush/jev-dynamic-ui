"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_RECORDING_MS } from "@/lib/stt/limits";

export type RecorderState = "idle" | "recording";

/** How often a recording in progress reports the audio so far. */
const PROGRESS_MS = 1000;

type RecorderCallbacks = {
  /** The finished clip, after stop. */
  onClip: (clip: Blob) => void;
  /** All the audio so far, about once a second while recording. It is a playable clip on its own. */
  onProgress?: (clipSoFar: Blob) => void;
  /** A message fit to show the customer (permission denied, no microphone). */
  onError: (message: string) => void;
};

/**
 * Records from the microphone. It knows nothing about what happens to the audio next.
 */
export function useRecorder(callbacksIn: RecorderCallbacks) {
  const [state, setState] = useState<RecorderState>("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  // Set the moment start() is called, before the microphone permission answers, so a second click can't open a second stream.
  const starting = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Always call the newest callbacks, even from a recording started before the last render.
  const callbacks = useRef(callbacksIn);
  useEffect(() => {
    callbacks.current = callbacksIn;
  });

  const stop = useCallback(() => {
    clearTimeout(stopTimer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorder.current || starting.current) return;
    starting.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      // Only the first chunk carries the file header, so every clip is the chunks from the start, joined.
      media.ondataavailable = (event) => {
        chunks.push(event.data);
        if (media.state === "recording") callbacks.current.onProgress?.(new Blob(chunks, { type: media.mimeType }));
      };
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop()); // turns the browser's "recording" indicator off
        recorder.current = null;
        setState("idle");
        callbacks.current.onClip(new Blob(chunks, { type: media.mimeType }));
      };
      recorder.current = media;
      media.start(PROGRESS_MS);
      setState("recording");
      stopTimer.current = setTimeout(stop, MAX_RECORDING_MS);
    } catch {
      callbacks.current.onError("I couldn't use the microphone. Allow microphone access, or type your request.");
    } finally {
      starting.current = false;
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
