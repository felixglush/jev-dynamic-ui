import { SAMPLE_RATE } from "./protocol";

/** 16-bit mono PCM frames as a WAV file, so a recording made for the streaming server can go to a batch engine too. */
export function encodeWav(frames: Int16Array[], sampleRate = SAMPLE_RATE): Blob {
  const samples = frames.reduce((sum, frame) => sum + frame.length, 0);
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset: number, value: string) => [...value].forEach((char, i) => header.setUint8(offset + i, char.charCodeAt(0)));
  text(0, "RIFF");
  header.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  header.setUint32(16, 16, true); // size of this block
  header.setUint16(20, 1, true); // plain PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true); // bytes per second
  header.setUint16(32, 2, true); // bytes per sample
  header.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  header.setUint32(40, samples * 2, true);
  // Int16Array is little-endian on every browser we run on, which is what WAV wants.
  return new Blob([header, ...frames.map((frame) => frame.slice())], { type: "audio/wav" });
}
