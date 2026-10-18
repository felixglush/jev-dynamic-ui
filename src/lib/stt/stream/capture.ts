import { PcmResampler } from "./pcm";
import { SAMPLE_RATE } from "./protocol";

/** Public URL of the AudioWorklet in /public that hands raw microphone audio to the page. */
const WORKLET_URL = "/pcm-worklet.js";

export type PcmCapture = { stop: () => void };

/**
 * Open the microphone and call `onFrame` with 16-bit 16 kHz mono PCM, about every 50 to 130 ms, until `stop()`.
 * Browser only. Throws if the microphone or AudioWorklet isn't available (the caller shows the message).
 */
export async function startPcmCapture(onFrame: (pcm: Int16Array) => void): Promise<PcmCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    // Ask for 16 kHz so the browser resamples; where it can't, the context keeps the device rate and we resample.
    const context = await newContext();
    await context.audioWorklet.addModule(WORKLET_URL);
    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, "pcm-capture");
    const resampler = new PcmResampler(context.sampleRate, SAMPLE_RATE);
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const pcm = resampler.push(event.data);
      if (pcm.length > 0) onFrame(pcm);
    };
    source.connect(worklet); // not connected to the speakers: nothing to hear while recording
    await context.resume();
    return {
      stop() {
        worklet.port.onmessage = null;
        source.disconnect();
        stream.getTracks().forEach((track) => track.stop()); // turns the browser's "recording" indicator off
        void context.close();
      },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}

async function newContext(): Promise<AudioContext> {
  try {
    return new AudioContext({ sampleRate: SAMPLE_RATE });
  } catch {
    return new AudioContext();
  }
}
