/**
 * transcribeClip with a stand-in engine. Any SttProvider works here, which is the point of the interface.
 * Nothing here says how accurate a real speech model is: see voice/bench.
 */
import { describe, expect, it, vi } from "vitest";
import { MAX_AUDIO_BYTES } from "./limits";
import { transcribeClip } from "./transcribe";
import type { SttProvider } from "./types";

const engine = (transcribe: SttProvider["transcribe"]): SttProvider => ({ name: "fake", transcribe });
const clip = new Blob(["audio"], { type: "audio/webm" });

describe("transcribeClip", () => {
  it("returns the engine's text", async () => {
    expect(await transcribeClip(clip, engine(async () => "pay my water bill"))).toEqual({ ok: true, text: "pay my water bill" });
  });

  it("refuses anything that is not a non-empty clip, without calling the engine", async () => {
    const transcribe = vi.fn();
    for (const bad of [null, "text", new Blob([])]) {
      expect(await transcribeClip(bad, engine(transcribe))).toMatchObject({ ok: false, error: "No audio was received." });
    }
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("refuses an oversize clip", async () => {
    const big = new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)]);
    expect(await transcribeClip(big, engine(vi.fn()))).toMatchObject({ ok: false, error: expect.stringContaining("too long") });
  });

  it("says so when nothing was heard", async () => {
    expect(await transcribeClip(clip, engine(async () => ""))).toMatchObject({ ok: false, error: expect.stringContaining("couldn't hear") });
  });

  it("hides engine failures behind a generic message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await transcribeClip(clip, engine(async () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:8000"))));
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("isn't reachable") });
    expect(JSON.stringify(outcome)).not.toContain("ECONNREFUSED");
  });
});
