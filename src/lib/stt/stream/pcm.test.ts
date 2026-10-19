import { describe, expect, it } from "vitest";
import { PcmResampler } from "./pcm";

describe("PcmResampler", () => {
  it("passes audio through at the same rate, as 16-bit integers", () => {
    const out = new PcmResampler(16_000, 16_000).push(Float32Array.from([0, 0.5, -0.5, 1, -1, 2]));
    // The last sample is held back until the next chunk arrives (it is needed to interpolate), so one fewer comes out.
    expect(Array.from(out)).toEqual([0, 16384, -16383, 32767, -32767]);
  });

  it("makes a third as many samples from 48 kHz audio", () => {
    const resampler = new PcmResampler(48_000, 16_000);
    const total = Array.from({ length: 10 }, () => resampler.push(new Float32Array(2048))).reduce((n, chunk) => n + chunk.length, 0);
    expect(Math.abs(total - (10 * 2048) / 3)).toBeLessThanOrEqual(1);
  });

  it("gives the same samples however the audio is cut into chunks", () => {
    const signal = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 20));
    const whole = new PcmResampler(48_000, 16_000).push(signal);
    const parts = new PcmResampler(48_000, 16_000);
    const pieces = [parts.push(signal.slice(0, 1000)), parts.push(signal.slice(1000, 1001)), parts.push(signal.slice(1001))];
    const joined = Int16Array.from(pieces.flatMap((piece) => Array.from(piece)));
    expect(Array.from(joined)).toEqual(Array.from(whole));
  });
});
