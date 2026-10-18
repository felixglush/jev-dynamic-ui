"use client";

import { useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

import { transcribeAudio } from "@/app/voice-actions";
import { useRecorder } from "@/components/use-recorder";
import { Button } from "@/components/ui/button";

/**
 * Press to start talking, press again to stop. The recording goes to the server for transcription and the text
 * comes back through `onTranscript`; what to do with it is the parent's business.
 */
export function MicButton({ onTranscript, onError }: { onTranscript: (text: string) => void; onError: (message: string) => void }) {
  const [transcribing, setTranscribing] = useState(false);

  const { state, start, stop } = useRecorder(async (clip) => {
    setTranscribing(true);
    try {
      const body = new FormData();
      body.set("audio", clip);
      const outcome = await transcribeAudio(body);
      if (outcome.ok) onTranscript(outcome.text);
      else onError(outcome.error);
    } catch {
      onError("Couldn’t reach the server. Check your connection and try again.");
    } finally {
      setTranscribing(false);
    }
  }, onError);

  const recording = state === "recording";
  return (
    <Button
      type="button"
      size="icon"
      variant={recording ? "default" : "ghost"}
      aria-label={recording ? "Stop recording" : "Record a message"}
      aria-pressed={recording}
      disabled={transcribing}
      onClick={recording ? stop : start}
      className="size-10 rounded-full"
    >
      {transcribing ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : recording ? <Square /> : <Mic />}
    </Button>
  );
}
