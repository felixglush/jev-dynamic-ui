/**
 * Turns the microphone's audio (32-bit floats at whatever rate the device uses, often 48 kHz) into the 16-bit
 * 16 kHz mono PCM the streaming protocol sends. Linear interpolation is plenty for speech. It remembers the last
 * sample between calls so the stream has no gaps at chunk edges.
 */
export class PcmResampler {
  private readonly step: number;
  private position = 0; // where the next output sample sits, in input samples; -1 means "the carried sample"
  private carried = 0;

  constructor(fromRate: number, toRate: number) {
    this.step = fromRate / toRate;
  }

  push(input: Float32Array): Int16Array {
    const out: number[] = [];
    const sample = (i: number) => (i < 0 ? this.carried : input[i]!);
    while (Math.floor(this.position) + 1 < input.length) {
      const i = Math.floor(this.position);
      const fraction = this.position - i;
      out.push(toInt16(sample(i) * (1 - fraction) + sample(i + 1) * fraction));
      this.position += this.step;
    }
    this.position -= input.length;
    if (input.length > 0) this.carried = input[input.length - 1]!;
    return Int16Array.from(out);
  }
}

function toInt16(value: number): number {
  return Math.round(Math.max(-1, Math.min(1, value)) * 32767);
}
