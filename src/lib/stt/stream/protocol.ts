/**
 * The wire format between the browser and a streaming speech-to-text server. Any server that speaks it can be
 * plugged in (the sherpa-onnx one in voice/server, or a gateway in front of a cloud service). It is the boundary
 * that keeps the engine swappable.
 *
 *   browser -> server   text   {"type":"start","sampleRate":16000}
 *                       binary 16-bit little-endian mono PCM frames, as they are recorded
 *                       text   {"type":"stop"}                       (the customer is done talking)
 *   server  -> browser  text   {"type":"partial","text":"..."}       (the text so far, replaces the last one)
 *                       text   {"type":"endpoint"}                   (the customer has stopped talking; the browser may send "stop")
 *                       text   {"type":"final","text":"..."}         (the finished text; the server then closes)
 *                       text   {"type":"error","message":"..."}
 */
export const SAMPLE_RATE = 16_000;

export type ClientMessage = { type: "start"; sampleRate: number } | { type: "stop" };

export type ServerMessage =
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "endpoint" }
  | { type: "error"; message: string };

/** Read one text frame from the server. Anything that isn't a known message is ignored (returns null). */
export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  const { type, text, message: detail } = message as Record<string, unknown>;
  if ((type === "partial" || type === "final") && typeof text === "string") return { type, text };
  if (type === "endpoint") return { type };
  if (type === "error" && typeof detail === "string") return { type, message: detail };
  return null;
}
