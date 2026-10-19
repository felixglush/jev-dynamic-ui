"use client";

import { useEffect, useState } from "react";

import { getSpeechConfig } from "@/app/voice-actions";
import { MicView } from "@/components/mic-view";
import { RecordedMicButton, type MicProps } from "@/components/recorded-mic-button";
import { StreamingMicButton } from "@/components/streaming-mic-button";

/**
 * The microphone button: live streaming when the server has a speech server configured, otherwise record then
 * transcribe. It asks the server which once, and shows a disabled button until it knows.
 */
export function MicButton(props: MicProps) {
  const [streamUrl, setStreamUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getSpeechConfig().then(
      (config) => !cancelled && setStreamUrl(config.streamUrl),
      () => !cancelled && setStreamUrl(null),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (streamUrl === undefined) return <MicView state="busy" onClick={() => {}} />;
  return streamUrl ? <StreamingMicButton url={streamUrl} {...props} /> : <RecordedMicButton {...props} />;
}
