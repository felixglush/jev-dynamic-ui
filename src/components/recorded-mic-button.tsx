"use client";

import { useRef, useState } from "react";

import { transcribeAudio } from "@/app/voice-actions";
import { useRecorder } from "@/components/use-recorder";
import { MicView } from "@/components/mic-view";

export type MicProps = {
  /** The text so far (`final` false, while still recording) or the finished text (`final` true). */
  onTranscript: (text: string, final: boolean) => void;
  onError: (message: string) => void;
};

/**
 * Record, then transcribe. Press to start talking, press again to stop. While recording, the audio so far is
 * transcribed again and again so the text appears as you speak; the parent decides what to do with each version.
 *
 * Only one partial request is out at a time, and only the newest audio waits behind it, so a slow engine falls
 * behind gracefully instead of queueing up. Once stop is pressed the final transcription replaces every partial.
 */
export function RecordedMicButton({ onTranscript, onError }: MicProps) {
  const [transcribing, setTranscribing] = useState(false);
  const partial = useRef({ busy: false, waiting: null as Blob | null, stopped: false });

  async function transcribe(clip: Blob): Promise<string | null> {
    const body = new FormData();
    body.set("audio", clip);
    try {
      const outcome = await transcribeAudio(body);
      if (outcome.ok) return outcome.text;
      onError(outcome.error);
    } catch {
      onError("Couldn’t reach the server. Check your connection and try again.");
    }
    return null;
  }

  async function sendPartial(clip: Blob) {
    const state = partial.current;
    if (state.busy) {
      state.waiting = clip; // replaces any older waiting clip
      return;
    }
    state.busy = true;
    const text = await transcribe(clip);
    state.busy = false;
    // A partial that finishes after stop would overwrite the final text.
    if (text && !state.stopped) onTranscript(text, false);
    const next = state.waiting;
    state.waiting = null;
    if (next && !state.stopped) void sendPartial(next);
  }

  const { state, start, stop } = useRecorder({
    onProgress: sendPartial,
    onClip: async (clip) => {
      partial.current.stopped = true;
      partial.current.waiting = null;
      setTranscribing(true);
      const text = await transcribe(clip);
      setTranscribing(false);
      if (text) onTranscript(text, true);
    },
    onError,
  });

  return (
    <MicView
      state={transcribing ? "busy" : state}
      onClick={
        state === "recording"
          ? stop
          : () => {
              partial.current = { busy: false, waiting: null, stopped: false };
              void start();
            }
      }
    />
  );
}
