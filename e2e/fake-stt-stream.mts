/**
 * A local stand-in for a streaming speech-to-text server (the WebSocket protocol in src/lib/stt/stream/protocol.ts),
 * used by the browser tests.
 *
 * It ignores the audio's content and acts out someone speaking: `POST /__say` with
 * `{"texts": ["Send $50", "Send $50 to Sam", "Send $75 to Sam for dinner"]}` makes it send a partial every 8000 bytes
 * of audio (a quarter second), walking through all texts but the last, and the last one as the final text when the
 * browser sends `stop`. `{"fail": true}` makes the next session answer with an error. The browser tests record a
 * beep from Chromium's fake microphone, so passing tests say nothing about how well any real model hears speech.
 * Run standalone with `node e2e/fake-stt-stream.mts` (the Playwright config does this).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.FAKE_STT_STREAM_PORT ?? 0);
const BYTES_PER_PARTIAL = 8000;
let texts: string[] = [];
let failing = false;

const server = http.createServer((req, res) => {
  let data = "";
  req.on("data", (chunk) => (data += chunk));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/__ready") return void res.end("{}");
    if (req.method === "POST" && req.url === "/__say") {
      ({ texts = [], fail: failing = false } = JSON.parse(data) as { texts?: string[]; fail?: boolean });
      return void res.end("{}");
    }
    res.statusCode = 404;
    res.end("{}");
  });
});

new WebSocketServer({ server }).on("connection", (socket) => {
  let bytes = 0;
  let sent = 0;
  if (failing) {
    socket.send(JSON.stringify({ type: "error", message: "The speech-to-text service is down. You can still type your request." }));
    return;
  }
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      bytes += (data as Buffer).length;
      while (bytes >= (sent + 1) * BYTES_PER_PARTIAL && texts.length > 1) {
        socket.send(JSON.stringify({ type: "partial", text: texts[Math.min(sent, texts.length - 2)] }));
        sent++;
      }
    } else if ((JSON.parse(data.toString()) as { type: string }).type === "stop") {
      socket.send(JSON.stringify({ type: "final", text: texts.at(-1) ?? "" }));
    }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`fake STT stream listening on ${(server.address() as AddressInfo).port}`));
