/**
 * The real WebSocketTranscriber talking real WebSocket frames to a stand-in server that answers like a streaming
 * engine would. It proves the protocol handling, not how well any model hears.
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { WebSocketTranscriber, type TranscriberHandlers } from "./transcriber";

let server: WebSocketServer;
let url: string;
let connected: ServerSocket | null;
let received: { text: string[]; bytes: number };
let onConnect: (socket: ServerSocket) => void;

beforeAll(async () => {
  server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on("connection", (socket) => {
    connected = socket;
    socket.on("message", (data, isBinary) => {
      if (isBinary) received.bytes += (data as Buffer).length;
      else received.text.push(data.toString());
    });
    onConnect(socket);
  });
});
afterAll(() => server.close());
beforeEach(() => {
  connected = null;
  received = { text: [], bytes: 0 };
  onConnect = () => {};
});

const handlers = () => ({ onPartial: vi.fn(), onFinal: vi.fn(), onError: vi.fn() }) satisfies TranscriberHandlers;
const until = (done: () => boolean) => vi.waitFor(() => expect(done()).toBe(true));

describe("WebSocketTranscriber", () => {
  it("opens with a start message, sends audio, and passes partial then final text on", async () => {
    const h = handlers();
    const transcriber = new WebSocketTranscriber(url);
    await transcriber.start(h);
    transcriber.send(Int16Array.from([1, 2, 3, 4]));
    transcriber.send(Int16Array.from([5, 6]));
    await until(() => received.bytes === 12);
    expect(received.text[0]).toBe('{"type":"start","sampleRate":16000}');

    connected!.send(JSON.stringify({ type: "partial", text: "send fifty" }));
    connected!.send(JSON.stringify({ type: "partial", text: "send fifty dollars" }));
    await until(() => h.onPartial.mock.calls.length === 2);
    expect(h.onPartial.mock.calls).toEqual([["send fifty"], ["send fifty dollars"]]);

    transcriber.stop();
    await until(() => received.text.includes('{"type":"stop"}'));
    connected!.send(JSON.stringify({ type: "final", text: "send fifty dollars to sam" }));
    await until(() => h.onFinal.mock.calls.length === 1);
    expect(h.onFinal).toHaveBeenCalledWith("send fifty dollars to sam");
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("reports a server error once and closes", async () => {
    const h = handlers();
    const transcriber = new WebSocketTranscriber(url);
    await transcriber.start(h);
    connected!.send(JSON.stringify({ type: "error", message: "model not loaded" }));
    await until(() => h.onError.mock.calls.length === 1);
    expect(h.onError).toHaveBeenCalledWith("model not loaded");
  });

  it("rejects start() when nothing is listening", async () => {
    const transcriber = new WebSocketTranscriber("ws://127.0.0.1:1");
    await expect(transcriber.start(handlers())).rejects.toThrow(/couldn't reach/);
  });

  it("reports a dropped connection through onError", async () => {
    const h = handlers();
    const transcriber = new WebSocketTranscriber(url);
    await transcriber.start(h);
    connected!.terminate();
    await until(() => h.onError.mock.calls.length === 1);
  });

  it("stays quiet after close(), even if the server answers late", async () => {
    const h = handlers();
    const transcriber = new WebSocketTranscriber(url);
    await transcriber.start(h);
    const socket = connected!;
    transcriber.close();
    socket.send(JSON.stringify({ type: "partial", text: "late" }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.onPartial).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });
});
