import { Loader2, Mic, Square } from "lucide-react";

import { Button } from "@/components/ui/button";

/** What the microphone button looks like; the two mic buttons only decide which state to show and what a click does. */
export function MicView({ state, onClick }: { state: "idle" | "recording" | "busy"; onClick: () => void }) {
  const recording = state === "recording";
  return (
    <Button
      type="button"
      size="icon"
      variant={recording ? "default" : "ghost"}
      aria-label={recording ? "Stop recording" : "Record a message"}
      aria-pressed={recording}
      disabled={state === "busy"}
      onClick={onClick}
      className="size-10 rounded-full"
    >
      {state === "busy" ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : recording ? <Square /> : <Mic />}
    </Button>
  );
}
