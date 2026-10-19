import { describe, expect, it } from "vitest";

import { encodeWav } from "./wav";

describe("encodeWav", () => {
  it("writes a 16 kHz mono 16-bit WAV that holds every frame in order", async () => {
    const wav = encodeWav([Int16Array.of(1, -2), Int16Array.of(300)]);
    const bytes = new DataView(await wav.arrayBuffer());
    expect(wav.type).toBe("audio/wav");
    expect(bytes.byteLength).toBe(44 + 6);
    expect(String.fromCharCode(...new Uint8Array(bytes.buffer, 0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...new Uint8Array(bytes.buffer, 8, 4))).toBe("WAVE");
    expect(bytes.getUint32(4, true)).toBe(36 + 6);
    expect(bytes.getUint32(24, true)).toBe(16000);
    expect(bytes.getUint16(22, true)).toBe(1);
    expect(bytes.getUint16(34, true)).toBe(16);
    expect(bytes.getUint32(40, true)).toBe(6);
    expect([44, 46, 48].map((offset) => bytes.getInt16(offset, true))).toEqual([1, -2, 300]);
  });
});
