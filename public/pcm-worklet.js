// Runs on the browser's audio thread. Collects the microphone's 128-sample blocks into larger chunks and posts them
// to the page, which resamples and sends them (src/lib/stt/stream/capture.ts).
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(2048);
    this.filled = 0;
    // On "flush" the page wants the audio that hasn't filled a whole chunk yet, then a "flushed" marker after it.
    this.port.onmessage = (event) => {
      if (event.data !== "flush") return;
      if (this.filled > 0) this.port.postMessage(this.chunk.slice(0, this.filled));
      this.filled = 0;
      this.port.postMessage("flushed");
    };
  }

  process(inputs) {
    const channel = inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.chunk[this.filled++] = channel[i];
      if (this.filled === this.chunk.length) {
        this.port.postMessage(this.chunk.slice());
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
