import { SAMPLE_RATE, parseServerMessage, type ClientMessage } from "./protocol";

export type TranscriberHandlers = {
  /** The text so far. Each one replaces the last. */
  onPartial: (text: string) => void;
  /** The finished text, after `stop()`. */
  onFinal: (text: string) => void;
  /** A message fit to show the customer. After it, the transcriber is closed. */
  onError: (message: string) => void;
};

/**
 * A live speech-to-text session: audio goes in as it is recorded, text comes out as it is understood. The mic
 * button only knows this shape, so the engine behind it can change.
 */
export interface StreamingTranscriber {
  start(handlers: TranscriberHandlers): Promise<void>;
  /** 16-bit 16 kHz mono PCM, in the order it was recorded. */
  send(pcm: Int16Array): void;
  /** The customer is done: the server finishes and answers with the final text. */
  stop(): void;
  /** Drop the connection now, without waiting for a final text. */
  close(): void;
}

const CONNECT_ERROR = "I couldn't reach the speech-to-text service. You can still type your request.";

/** A streaming session over a WebSocket speaking the protocol in protocol.ts. */
export class WebSocketTranscriber implements StreamingTranscriber {
  private socket: WebSocket | null = null;

  constructor(
    private readonly url: string,
    // Injectable so tests can run it under plain Node.
    private readonly Socket: typeof WebSocket = WebSocket,
  ) {}

  start(handlers: TranscriberHandlers): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new this.Socket(this.url);
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      let opened = false;
      let finished = false; // a final text or an error has been delivered

      socket.onopen = () => {
        opened = true;
        this.sendJson({ type: "start", sampleRate: SAMPLE_RATE });
        resolve();
      };
      socket.onmessage = (event) => {
        const message = parseServerMessage(event.data);
        if (!message || finished) return;
        if (message.type === "partial") handlers.onPartial(message.text);
        else if (message.type === "final") {
          finished = true;
          handlers.onFinal(message.text);
          this.close();
        } else {
          finished = true;
          handlers.onError(message.message);
          this.close();
        }
      };
      // Failing before the socket opened rejects start(); failing later (or closing early) reports through onError.
      // (By the time an error event fires the socket already reads as closed, so `opened` is what tells them apart.)
      socket.onerror = socket.onclose = () => {
        if (this.socket !== socket) return; // closed on purpose
        this.socket = null;
        if (finished) return;
        finished = true;
        if (!opened) reject(new Error(CONNECT_ERROR));
        else handlers.onError(CONNECT_ERROR);
      };
    });
  }

  send(pcm: Int16Array): void {
    if (this.socket?.readyState === this.Socket.OPEN) this.socket.send(pcm.slice());
  }

  stop(): void {
    this.sendJson({ type: "stop" });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private sendJson(message: ClientMessage) {
    if (this.socket?.readyState === this.Socket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
