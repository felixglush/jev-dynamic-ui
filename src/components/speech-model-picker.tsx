"use client";

import type { SttModel } from "@/lib/stt/types";

/** The dropdown's value for "no second pass": the live transcript stands as it is. Only offered when streaming. */
export const LIVE_ONLY = "live";

/**
 * Which speech model re-hears a recording when you stop, so models can be compared without restarting the server.
 * The server loads a model the first time it is picked, so the first recording after a switch is slower.
 */
export function SpeechModelPicker({
  models,
  liveOption,
  value,
  onChange,
}: {
  models: SttModel[];
  liveOption: boolean;
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  return (
    <select
      aria-label="Speech model"
      title="Speech model"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 max-w-[10rem] cursor-pointer truncate rounded-full border bg-transparent px-2 text-xs text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {liveOption && <option value={LIVE_ONLY}>Live only</option>}
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      ))}
    </select>
  );
}
